import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import WebSocket from 'ws';
import axios from 'axios';
import { GtfsRealtimePublisherService } from '../publisher/gtfs-realtime-publisher.service';
import { TokenProviderService } from '../auth/token-provider.service';
import { LmtSourceExtractorService } from './lmt-source-extractor.service';

export interface ActiveBus {
  bus_id: string;
  regNum: string;
  trip_id: string;
  route_id: string;
  route_code: string;
  direction_id: number;
  lastTicketTime: number;
}

interface LastPosition {
  latitude: number;
  longitude: number;
  timestamp: number;
  speed: number;
  bearing: number;
}

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function calculateBearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  const brng = (Math.atan2(y, x) * 180) / Math.PI;
  return Math.round((brng + 360) % 360);
}

export function isValidLmtBus(
  regNum: string,
  lat: number,
  lng: number,
  speedKmh?: number,
  isAssigned = false,
): boolean {
  if (isNaN(lat) || isNaN(lng)) return false;

  // 1. Colombo Metropolitan Operating Area Geofence (excludes Kandy, Jaffna, Galle, Ocean)
  if (lat < 6.68 || lat > 7.22 || lng < 79.82 || lng > 80.15) {
    return false;
  }
  // Exclude western ocean waters
  if (lng < 79.842 && lat < 6.92) return false;
  if (lng < 79.83) return false;

  // 2. Reject Simulator / Test / Mock IoT Devices
  const upper = (regNum || '').toUpperCase().trim();
  if (
    upper.length === 0 ||
    upper.startsWith('TEST') ||
    upper.startsWith('SUN-') ||
    upper.startsWith('DEV-') ||
    upper.startsWith('SIM-') ||
    upper === 'UNKNOWN_BUS' ||
    /^(0{3,}|1{3,}|2{3,}|3{3,}|4{3,}|5{3,}|12345|54321)/.test(upper) ||
    /^\d{5}$/.test(upper)
  ) {
    return false;
  }

  // 3. Genuine Sri Lankan commercial vehicle plate regex: e.g. WP-NE-5234, NE-6532, ND-1234, NA-5678, WP-ND-1234
  const isSriLankanPlate = /^(?:[A-Z]{2}-)?[A-Z]{2,3}-\d{3,4}$/.test(upper) || /^[A-Z]{2,3}\d{4}$/.test(upper);

  if (!isAssigned && !isSriLankanPlate) {
    return false;
  }

  // 4. Plausible speed filter
  if (speedKmh !== undefined && speedKmh > 120) {
    return false;
  }

  return true;
}

@Injectable()
export class LmtWebsocketService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LmtWebsocketService.name);

  // In-Memory Active Fleet State
  private activeFleet = new Map<string, ActiveBus>();
  private lastPositionMap = new Map<string, LastPosition>();
  private lastPollTimestamp = 0;
  private lastFleetSyncTimestamp = 0;
  private currentIntervalMs = 6000;
  private backoffMultiplier = 1;
  private backoffTimer: NodeJS.Timeout | null = null;
  private isPollingActive = false;
  private pollTimeout: NodeJS.Timeout | null = null;
  private fleetSyncInterval: NodeJS.Timeout | null = null;

  // Legacy WebSocket Support (Deprecated)
  private ws: WebSocket | null = null;
  private pingInterval: NodeJS.Timeout | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private isWsConnected = false;

  constructor(
    private readonly publisher: GtfsRealtimePublisherService,
    private readonly tokenProvider: TokenProviderService,
    private readonly sourceExtractor: LmtSourceExtractorService,
  ) {}

  async onModuleInit() {
    this.logger.log('🚀 Initializing LMT Telemetry Engine...');

    // 1. Initial Fleet Discovery from live ticketing stream
    await this.syncActiveFleetFromTickets();

    // 2. Start ongoing Fleet Discovery loop (every 25 seconds)
    this.fleetSyncInterval = setInterval(async () => {
      await this.syncActiveFleetFromTickets();
    }, 25000);

    // 3. Start Dynamic Adaptive Telemetry Polling loop
    this.scheduleNextTelemetryPoll(1000);

    // 4. Connect Legacy WebSocket ONLY if explicitly enabled via environment variable
    if (process.env.ENABLE_LEGACY_WS === 'true') {
      this.logger.log('Legacy WebSocket enabled via ENABLE_LEGACY_WS=true.');
      this.connectLegacyWebSocket();
    } else {
      this.logger.log(
        'ℹ️ Legacy WebSocket is deprecated and dormant by default. Telemetry runs via high-frequency adaptive ticket-stream polling.',
      );
    }
  }

  onModuleDestroy() {
    this.disconnectLegacyWebSocket();
    if (this.fleetSyncInterval) clearInterval(this.fleetSyncInterval);
    if (this.pollTimeout) clearTimeout(this.pollTimeout);
    if (this.backoffTimer) clearTimeout(this.backoffTimer);
  }

  // --- Observability Metrics ---

  public getIsConnected(): boolean {
    return this.isWsConnected || this.activeFleet.size > 0;
  }

  public getActiveBusesCount(): number {
    return this.activeFleet.size;
  }

  public getTrackedBusesList(): string[] {
    return Array.from(this.activeFleet.values()).map((b) => b.regNum);
  }

  public getLastPollTimestamp(): number {
    return this.lastPollTimestamp;
  }

  public getCurrentIntervalMs(): number {
    return this.currentIntervalMs;
  }

  public getUpstreamStatus(): string {
    if (this.backoffMultiplier > 1) return 'throttled';
    return this.activeFleet.size > 0 ? 'healthy' : 'discovering';
  }

  // --- Stage 1: Fleet Discovery from Ticket Issuance Stream ---

  /**
   * Discovers currently operating commercial buses across Colombo by reading recent ticket issuances.
   * Every ticket issued contains the exact bus_id, registration number, route_id, route_code, and direction.
   */
  public async syncActiveFleetFromTickets(): Promise<void> {
    try {
      const token = await this.tokenProvider.getOrRefreshToken();
      const headers = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Origin: 'https://lankametro.lk',
        Referer: 'https://lankametro.lk/en/smartmetro',
      };

      const url = 'https://lankametro.lk/metrobus-proxy/ticketing-service/api/v1/tickets?page=1&limit=60';
      const resp = await axios.get(url, { headers, timeout: 6000 });

      if (resp.status === 200 && resp.data?.data?.data) {
        const tickets: any[] = resp.data.data.data;
        const now = Date.now();
        let newDiscovered = 0;

        for (const t of tickets) {
          const busId = t.bus_id;
          const reg = (t.bus_registration_number || '').trim();

          // Only track genuine commercial plates
          if (!busId || !reg || !isValidLmtBus(reg, 6.9, 79.9, undefined, false)) {
            continue;
          }

          const ticketTime = t.issued_at ? new Date(t.issued_at).getTime() : now;
          const dirInt = typeof t.direction_id === 'number'
            ? t.direction_id
            : (t.direction_id ? parseInt(String(t.direction_id), 10) || 0 : 0);

          if (!this.activeFleet.has(busId)) {
            newDiscovered++;
          }

          this.activeFleet.set(busId, {
            bus_id: busId,
            regNum: reg,
            trip_id: t.trip_id || `LMT_${(t.route_code || 'CM').slice(0, 4)}_${dirInt}_${reg}`,
            route_id: t.route_id || '',
            route_code: t.route_code || '',
            direction_id: dirInt,
            lastTicketTime: ticketTime,
          });
        }

        // Evict buses that haven't issued a ticket in >45 minutes
        const evictionThreshold = now - 45 * 60 * 1000;
        for (const [busId, bus] of this.activeFleet.entries()) {
          if (bus.lastTicketTime < evictionThreshold) {
            this.activeFleet.delete(busId);
            this.lastPositionMap.delete(bus.regNum);
          }
        }

        this.lastFleetSyncTimestamp = now;
        if (newDiscovered > 0) {
          this.logger.log(`🚌 Discovered ${newDiscovered} new active buses! Total fleet tracked: ${this.activeFleet.size}`);
        }
      }
    } catch (err: any) {
      if (err.response?.status === 401) {
        this.logger.warn('Received 401 Unauthorized during ticket fleet sync. Forcing token refresh.');
        this.tokenProvider.forceRefreshToken().catch(() => {});
      } else {
        this.logger.warn(`Ticket fleet sync notice: ${err.message}`);
      }
    }
  }

  // --- Stage 2: Dynamic Adaptive High-Frequency Telemetry Ingestion ---

  private scheduleNextTelemetryPoll(delayMs: number) {
    if (this.pollTimeout) clearTimeout(this.pollTimeout);
    this.pollTimeout = setTimeout(async () => {
      await this.executeAdaptiveTelemetryCycle();
    }, delayMs);
  }

  /**
   * Executes a complete telemetry polling cycle with dynamic adaptive rate limiting.
   * Adapts chunk size and inter-chunk delays according to fleet size to maintain
   * a strict upstream Cloudflare WAF budget (< 5 req/sec).
   */
  private async executeAdaptiveTelemetryCycle(): Promise<void> {
    if (this.isPollingActive) return;
    this.isPollingActive = true;

    try {
      const fleetSize = this.activeFleet.size;

      if (fleetSize === 0) {
        this.currentIntervalMs = 5000;
        this.scheduleNextTelemetryPoll(5000);
        return;
      }

      // Dynamic Adaptive Rate Limiting
      // Target: max 4.5 RPS against upstream proxy
      const MAX_RPS = 4.5;
      const baseIntervalMs = Math.max(5000, Math.ceil((fleetSize / MAX_RPS) * 1000));
      this.currentIntervalMs = baseIntervalMs * this.backoffMultiplier;

      const token = await this.tokenProvider.getOrRefreshToken();
      const headers = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Origin: 'https://lankametro.lk',
        Referer: 'https://lankametro.lk/en/smartmetro',
      };

      const buses = Array.from(this.activeFleet.values());
      // Dynamic worker chunk size: 4 to 8 concurrent requests
      const chunkSize = Math.min(8, Math.max(4, Math.ceil(fleetSize / 4)));
      const chunkCount = Math.ceil(fleetSize / chunkSize);
      const interChunkDelayMs = Math.max(60, Math.floor(this.currentIntervalMs / Math.max(1, chunkCount * 2)));

      const batchPositions: any[] = [];
      let rateLimited = false;

      for (let i = 0; i < buses.length; i += chunkSize) {
        const chunk = buses.slice(i, i + chunkSize);

        await Promise.all(
          chunk.map(async (bus) => {
            try {
              const url = `https://lankametro.lk/metrobus-proxy/ticketing-service/api/v1/buses/${bus.bus_id}/tracking`;
              const resp = await axios.get(url, { headers, timeout: 3800 });

              if (resp.status === 200 && resp.data?.data) {
                const data = resp.data.data;
                const loc = data.bus_location;

                if (loc && typeof loc.lat === 'number' && typeof loc.lng === 'number') {
                  if (!isValidLmtBus(bus.regNum, loc.lat, loc.lng, undefined, true)) {
                    return;
                  }

                  const timestampMs = loc.recorded_at ? new Date(loc.recorded_at).getTime() : Date.now();
                  const prevPos = this.lastPositionMap.get(bus.regNum);

                  let computedSpeed = 0;
                  let computedBearing = 0;

                  if (prevPos) {
                    const distMeters = haversineMeters(prevPos.latitude, prevPos.longitude, loc.lat, loc.lng);
                    const dtSec = (timestampMs - prevPos.timestamp) / 1000;

                    if (dtSec > 0) {
                      if (distMeters > 4.0) {
                        computedSpeed = Math.round((distMeters / dtSec) * 3.6 * 10) / 10; // km/h
                        computedBearing = calculateBearingDeg(prevPos.latitude, prevPos.longitude, loc.lat, loc.lng);
                      } else {
                        computedSpeed = 0;
                        computedBearing = prevPos.bearing; // Keep stable previous heading
                      }
                    } else {
                      computedSpeed = prevPos.speed;
                      computedBearing = prevPos.bearing;
                    }
                  }

                  this.lastPositionMap.set(bus.regNum, {
                    latitude: loc.lat,
                    longitude: loc.lng,
                    timestamp: timestampMs,
                    speed: computedSpeed,
                    bearing: computedBearing,
                  });

                  batchPositions.push({
                    trip_id: bus.trip_id,
                    route_id: bus.route_code || bus.route_id || undefined,
                    direction_id: bus.direction_id,
                    vehicle_id: bus.regNum,
                    vehicle_label: bus.regNum,
                    license_plate: bus.regNum,
                    latitude: loc.lat,
                    longitude: loc.lng,
                    speed: computedSpeed,
                    bearing: computedBearing,
                    timestamp: new Date(timestampMs).toISOString(),
                  });
                }
              }
            } catch (err: any) {
              if (err.response?.status === 429) {
                rateLimited = true;
              } else if (err.response?.status === 401) {
                this.tokenProvider.forceRefreshToken().catch(() => {});
              }
            }
          }),
        );

        if (i + chunkSize < buses.length) {
          await new Promise((r) => setTimeout(r, interChunkDelayMs));
        }
      }

      // Handle Rate Limit Backoff dynamically
      if (rateLimited) {
        this.triggerAdaptiveBackoff();
      }

      // Publish batch of live GPS coordinates to transit server
      if (batchPositions.length > 0) {
        this.lastPollTimestamp = Date.now();
        await this.publisher.publishVehiclePositionsBatch(batchPositions);
        this.logger.log(
          `📍 Ingested telemetry for ${batchPositions.length}/${fleetSize} buses (cadence: ${this.currentIntervalMs / 1000}s, backoff: ${this.backoffMultiplier}x)`,
        );
      }
    } catch (err: any) {
      this.logger.error(`Telemetry polling cycle error: ${err.message}`);
    } finally {
      this.isPollingActive = false;
      this.scheduleNextTelemetryPoll(this.currentIntervalMs);
    }
  }

  private triggerAdaptiveBackoff() {
    this.logger.warn('⚠️ Upstream rate-limit (429) detected! Activating 2x adaptive backoff multiplier for 60 seconds.');
    this.backoffMultiplier = 2;
    if (this.backoffTimer) clearTimeout(this.backoffTimer);
    this.backoffTimer = setTimeout(() => {
      this.logger.log('✅ Restoring normal rate-limit cadence.');
      this.backoffMultiplier = 1;
    }, 60000);
  }

  // --- Deprecated: Legacy WebSocket Support ---

  /**
   * @deprecated Upstream Eimsky WebSocket currently streams only 500 dummy simulator bots
   * while lankametro.lk/ws-proxy yields 502 Bad Gateway.
   * Real commercial buses are tracked via ticket-stream discovery and high-frequency polling.
   */
  private async connectLegacyWebSocket(forceTokenRefresh = false) {
    const wsUrl = process.env.LMT_WS_URL || 'wss://metrobusapiprod.eimsky.com/ticketing-service/ws';
    let token = '';

    try {
      token = await this.tokenProvider.getOrRefreshToken(forceTokenRefresh);
    } catch (err: any) {
      this.scheduleWsReconnect(10000);
      return;
    }

    const fullUrl = token ? `${wsUrl}?token=${token}` : wsUrl;

    try {
      this.ws = new WebSocket(fullUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Origin: 'https://lankametro.lk',
        },
      });

      this.ws.on('open', () => {
        this.logger.log('⚡ Connected to legacy WebSocket stream.');
        this.isWsConnected = true;
        this.startWsHeartbeat();
      });

      this.ws.on('message', (data: WebSocket.RawData) => {
        this.handleLegacyWsMessage(data);
      });

      this.ws.on('error', (err) => {
        this.logger.warn(`Legacy WebSocket error: ${err.message}`);
      });

      this.ws.on('close', (code, reason) => {
        this.isWsConnected = false;
        this.stopWsHeartbeat();
        const isAuth = code === 401 || reason.toString().includes('401');
        this.scheduleWsReconnect(10000, isAuth);
      });
    } catch {
      this.scheduleWsReconnect(10000, true);
    }
  }

  private startWsHeartbeat() {
    this.stopWsHeartbeat();
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, 30000);
  }

  private stopWsHeartbeat() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private scheduleWsReconnect(delayMs = 10000, forceTokenRefresh = false) {
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    this.reconnectTimeout = setTimeout(() => {
      this.connectLegacyWebSocket(forceTokenRefresh);
    }, delayMs);
  }

  private disconnectLegacyWebSocket() {
    this.stopWsHeartbeat();
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
    this.isWsConnected = false;
  }

  private async handleLegacyWsMessage(rawData: WebSocket.RawData) {
    try {
      const text = rawData.toString();
      if (!text || text.trim() === '') return;

      const messageObj = JSON.parse(text);
      const eventType = messageObj.type || messageObj.event;
      const rawPayload = messageObj.payload;

      if (eventType === 'gps_update' && rawPayload) {
        const busList: any[] = Array.isArray(rawPayload) ? rawPayload : [rawPayload];
        const batchPositions: any[] = [];

        for (const bus of busList) {
          const regNum = bus.registration_number || bus.busReg || bus.vehicle_id;
          const lat = parseFloat(bus.lat || bus.latitude);
          const lng = parseFloat(bus.lng || bus.longitude);

          // Strictly reject simulator devices
          if (!isValidLmtBus(regNum, lat, lng, undefined, false)) {
            continue;
          }

          batchPositions.push({
            trip_id: bus.trip_id || `LMT_TRIP_${regNum}`,
            route_id: bus.route_id,
            direction_id: bus.direction_id || 0,
            vehicle_id: regNum,
            vehicle_label: regNum,
            license_plate: regNum,
            latitude: lat,
            longitude: lng,
            speed: parseFloat(bus.speed) || 0,
            bearing: parseFloat(bus.bearing || bus.heading) || 0,
            timestamp: new Date().toISOString(),
          });
        }

        if (batchPositions.length > 0) {
          await this.publisher.publishVehiclePositionsBatch(batchPositions);
        }
      }
    } catch {}
  }
}
