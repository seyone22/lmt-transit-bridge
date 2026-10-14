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
  lastBoardingStop?: string;
  latitude?: number;
  longitude?: number;
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

  // Stop Cache for Resilient Telemetry Fallback
  private stopMapById = new Map<string, { lat: number; lng: number; name: string }>();
  private stopMapByName = new Map<string, { lat: number; lng: number; name: string }>();
  private stopsInitialized = false;

  // Route & Direction Mappings (Preloaded with defaults and dynamically updated from /routes/geo)
  private routeIdToCodeMap = new Map<string, string>([
    ['f3eaf277-a6fa-4f5b-8a61-3b1758d9a4b8', 'CM01'],
    ['74dc11d6-2ec4-48ab-9abe-fc5d89b7ed7f', 'CM02'],
    ['8bc594e3-8ad6-4a0d-9138-bf8b4247e2f5', 'CM03'],
    ['5209a823-76f1-425e-8fd1-66bf5f65b56a', 'CM04'],
    ['19faf899-99cc-4e06-94bc-1d74f4c307fd', 'CM05'],
    ['f4c9e297-f8ee-4c39-b5a5-cdec7674e756', 'CM06'],
    ['0622f9e1-5730-41ec-be03-2125aa3f9075', 'CM08'],
  ]);
  private directionIdToIntMap = new Map<string, number>([
    ['401ccb91-2269-471d-877c-1af77d98dba3', 0],
    ['47831874-290c-4beb-959a-3e004f8e0e00', 1],
    ['5e339897-322c-4bea-af10-a8e321a470ec', 0],
    ['fd210485-e204-4aec-9af5-359753f3a776', 1],
    ['fe423b83-34e7-4bd5-816b-97968dcd2b1f', 0],
    ['7a0aa9fc-7d82-4e7b-94ac-2bc488160194', 1],
    ['1b314dc5-938c-4da2-946b-5f90271a4ea2', 0],
    ['42ecc596-3eb2-4935-8fd8-6122c6198202', 1],
    ['fd7b32c1-7592-4c9c-8212-f1e9d6e5de91', 1],
    ['75a0a66c-44a3-43c5-aa4a-f4e37289768c', 0],
    ['d3c6a8f0-d5da-4806-90b5-66bb95bd887e', 0],
    ['85eb01c2-7d08-4b7d-b909-07384a32c97d', 1],
    ['0f384060-9c29-4a6d-ba99-bb90c22f52cc', 0],
    ['3721dbd2-848f-4ee9-a4dc-4c2647e45497', 1],
  ]);

  // WebSocket Telemetry Connection
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

    // 0. Pre-load transit stop and route metadata
    await this.ensureStopsLoaded();
    await this.ensureRouteMetadataLoaded();

    // 1. Connect Primary High-Frequency Live WebSocket Stream
    this.connectWebSocket();

    // 2. Background Ticket Discovery fallback loop (every 30 seconds)
    this.fleetSyncInterval = setInterval(async () => {
      await this.syncActiveFleetFromTickets();
    }, 30000);

    // 3. Dynamic Adaptive Telemetry Polling fallback loop
    this.scheduleNextTelemetryPoll(5000);
  }

  onModuleDestroy() {
    this.disconnectWebSocket();
    if (this.fleetSyncInterval) clearInterval(this.fleetSyncInterval);
    if (this.pollTimeout) clearTimeout(this.pollTimeout);
    if (this.backoffTimer) clearTimeout(this.backoffTimer);
  }

  private async ensureRouteMetadataLoaded(): Promise<void> {
    try {
      const geoUrl = process.env.LMT_ROUTES_GEO_URL || 'https://lankametro.lk/metrobus-proxy/fare-service/api/v1/routes/geo';
      const res = await axios.get(geoUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Accept: 'application/json',
        },
        timeout: 6000,
      });

      if (res.status === 200 && Array.isArray(res.data?.data?.routes)) {
        for (const r of res.data.data.routes) {
          if (r.id && r.code) {
            this.routeIdToCodeMap.set(r.id, r.code);
          }
          if (Array.isArray(r.directions)) {
            r.directions.forEach((d: any, idx: number) => {
              if (d.id) {
                this.directionIdToIntMap.set(d.id, idx);
              }
            });
          }
        }
        this.logger.log(`📍 Loaded metadata for ${this.routeIdToCodeMap.size} transit routes and ${this.directionIdToIntMap.size} directions.`);
      }
    } catch (e: any) {
      this.logger.warn(`Route metadata preloading notice (using defaults): ${e.message}`);
    }
  }

  private async ensureStopsLoaded(): Promise<void> {
    if (this.stopsInitialized && this.stopMapById.size > 0) return;
    try {
      const data = await this.sourceExtractor.getTransitData();
      for (const s of data.stops) {
        if (s.eimsky_id) {
          this.stopMapById.set(s.eimsky_id, { lat: s.lat, lng: s.lng, name: s.name });
        }
        if (s.name) {
          this.stopMapByName.set(s.name.toLowerCase().trim(), { lat: s.lat, lng: s.lng, name: s.name });
        }
      }
      this.stopsInitialized = true;
      this.logger.log(`📍 Loaded ${this.stopMapById.size} transit stops for real-time corridor positioning.`);
    } catch (e: any) {
      this.logger.warn(`Stops preloading notice: ${e.message}`);
    }
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
    if (this.isWsConnected) return 'healthy';
    if (this.backoffMultiplier > 1) return 'throttled';
    return this.activeFleet.size > 0 ? 'healthy' : 'connecting';
  }

  // --- Stage 1: Fleet Discovery from Ticket Issuance Stream ---

  /**
   * Discovers currently operating commercial buses across Colombo by reading recent ticket issuances.
   * Every ticket issued contains the exact bus_id, registration number, route_id, route_code, direction,
   * and boarding stop GPS location.
   */
  public async syncActiveFleetFromTickets(): Promise<void> {
    if (this.isWsConnected && this.activeFleet.size > 0) {
      return;
    }
    await this.ensureStopsLoaded();
    try {
      const token = await this.tokenProvider.getOrRefreshToken();
      const headers = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Origin: 'https://lankametro.lk',
        Referer: 'https://lankametro.lk/en/smartmetro',
      };

      // Query page 1 and page 2 in parallel for complete metropolitan fleet coverage
      const [res1, res2] = await Promise.all([
        axios.get('https://lankametro.lk/metrobus-proxy/ticketing-service/api/v1/tickets?page=1&limit=60', { headers, timeout: 6000 }),
        axios.get('https://lankametro.lk/metrobus-proxy/ticketing-service/api/v1/tickets?page=2&limit=60', { headers, timeout: 6000 }).catch(() => ({ status: 200, data: { data: { data: [] } } })),
      ]);

      const tickets: any[] = [
        ...(res1.status === 200 && res1.data?.data?.data ? res1.data.data.data : []),
        ...(res2.status === 200 && (res2 as any).data?.data?.data ? (res2 as any).data.data.data : []),
      ];

      if (tickets.length > 0) {
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

          let stopLoc = t.boarding_stop_id ? this.stopMapById.get(t.boarding_stop_id) : undefined;
          if (!stopLoc && t.boarding_stop_name) {
            stopLoc = this.stopMapByName.get(t.boarding_stop_name.toLowerCase().trim());
          }

          if (!this.activeFleet.has(busId)) {
            newDiscovered++;
          }

          const existing = this.activeFleet.get(busId);
          const isNewer = !existing || ticketTime >= existing.lastTicketTime;

          this.activeFleet.set(busId, {
            bus_id: busId,
            regNum: reg,
            trip_id: t.trip_id || `LMT_${(t.route_code || 'CM').slice(0, 4)}_${dirInt}_${reg}`,
            route_id: t.route_id || '',
            route_code: t.route_code || '',
            direction_id: dirInt,
            lastTicketTime: isNewer ? ticketTime : (existing?.lastTicketTime || ticketTime),
            lastBoardingStop: isNewer ? (t.boarding_stop_name || existing?.lastBoardingStop) : existing?.lastBoardingStop,
            latitude: isNewer ? (stopLoc?.lat ?? existing?.latitude) : existing?.latitude,
            longitude: isNewer ? (stopLoc?.lng ?? existing?.longitude) : existing?.longitude,
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
   * Multi-strategy resilience:
   * Strategy 1: Attempt direct high-precision hardware GPS tracking endpoint.
   * Strategy 2: Seamlessly fall back to real-time ticketing boarding stop progression
   *             whenever upstream tracking is 403, 404, 502, or degraded.
   */
  private async executeAdaptiveTelemetryCycle(): Promise<void> {
    if (this.isPollingActive) return;
    if (this.isWsConnected && this.activeFleet.size > 0) {
      // Live WebSocket stream is primary and streaming. No HTTP polling needed.
      this.scheduleNextTelemetryPoll(5000);
      return;
    }
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
      const chunkSize = Math.min(8, Math.max(4, Math.ceil(fleetSize / 4)));
      const chunkCount = Math.ceil(fleetSize / chunkSize);
      const interChunkDelayMs = Math.max(60, Math.floor(this.currentIntervalMs / Math.max(1, chunkCount * 2)));

      const batchPositions: any[] = [];
      let rateLimited = false;

      for (let i = 0; i < buses.length; i += chunkSize) {
        const chunk = buses.slice(i, i + chunkSize);

        await Promise.all(
          chunk.map(async (bus) => {
            let lat: number | undefined = undefined;
            let lng: number | undefined = undefined;
            let timestampMs: number = Date.now();
            let rawSpeed: number | undefined = undefined;
            let rawBearing: number | undefined = undefined;

            // Strategy 1: Attempt direct high-precision hardware GPS tracking endpoint
            try {
              const url = `https://lankametro.lk/metrobus-proxy/ticketing-service/api/v1/buses/${bus.bus_id}/tracking`;
              const resp = await axios.get(url, { headers, timeout: 3500 });

              if (resp.status === 200 && resp.data?.data) {
                const loc = resp.data.data.bus_location;
                if (loc && typeof loc.lat === 'number' && typeof loc.lng === 'number') {
                  lat = loc.lat;
                  lng = loc.lng;
                  timestampMs = loc.recorded_at ? new Date(loc.recorded_at).getTime() : Date.now();
                  if (typeof loc.speed === 'number') rawSpeed = loc.speed;
                  if (typeof loc.bearing === 'number') rawBearing = loc.bearing;
                }
              }
            } catch (err: any) {
              if (err.response?.status === 429) {
                rateLimited = true;
              } else if (err.response?.status === 401) {
                this.tokenProvider.forceRefreshToken().catch(() => {});
              }
              // 403/404/502: Handled gracefully via Strategy 2 fallback below
            }

            // Strategy 2: Fallback to real-time ticket issuance boarding stop position
            if (lat === undefined || lng === undefined) {
              if (bus.latitude !== undefined && bus.longitude !== undefined) {
                lat = bus.latitude;
                lng = bus.longitude;
                timestampMs = bus.lastTicketTime || Date.now();
              }
            }

            if (lat !== undefined && lng !== undefined) {
              if (!isValidLmtBus(bus.regNum, lat, lng, undefined, true)) {
                return;
              }

              const prevPos = this.lastPositionMap.get(bus.regNum);
              let computedSpeed = rawSpeed || 0;
              let computedBearing = rawBearing || 0;

              if (prevPos) {
                const distMeters = haversineMeters(prevPos.latitude, prevPos.longitude, lat, lng);
                const dtSec = (timestampMs - prevPos.timestamp) / 1000;

                if (dtSec > 0) {
                  if (distMeters > 4.0) {
                    computedSpeed = Math.round((distMeters / dtSec) * 3.6 * 10) / 10;
                    computedBearing = calculateBearingDeg(prevPos.latitude, prevPos.longitude, lat, lng);
                  } else {
                    computedSpeed = prevPos.speed > 0 ? prevPos.speed : 15.0;
                    computedBearing = prevPos.bearing;
                  }
                } else {
                  computedSpeed = prevPos.speed || 15.0;
                  computedBearing = prevPos.bearing;
                }
              } else {
                computedSpeed = 18.0;
              }

              this.lastPositionMap.set(bus.regNum, {
                latitude: lat,
                longitude: lng,
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
                latitude: lat,
                longitude: lng,
                speed: computedSpeed,
                bearing: computedBearing,
                timestamp: new Date(timestampMs).toISOString(),
              });
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

  // --- Stage 3: High-Frequency Real-Time WebSocket Telemetry Engine ---

  private getWsUrl(): string {
    const envUrl = process.env.LMT_WS_URL?.trim();
    if (envUrl && !envUrl.includes('eimsky.com')) {
      return envUrl;
    }
    return 'wss://lankametro.lk/ws-proxy/ticketing-service/ws';
  }

  private connectWebSocket() {
    const wsUrl = this.getWsUrl();
    this.logger.log(`🔌 Connecting to live Lanka Metro WebSocket stream: ${wsUrl}...`);

    try {
      this.ws = new WebSocket(wsUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Origin: 'https://lankametro.lk',
        },
      });

      this.ws.on('open', () => {
        this.logger.log('⚡ Connected to live Lanka Metro WebSocket stream (no auth token required).');
        this.isWsConnected = true;
        this.currentIntervalMs = 5000;
        this.startWsHeartbeat();
      });

      this.ws.on('message', (data: WebSocket.RawData) => {
        this.handleWsMessage(data);
      });

      this.ws.on('error', (err) => {
        this.logger.warn(`WebSocket error: ${err.message}`);
      });

      this.ws.on('close', (code, reason) => {
        this.logger.warn(
          `WebSocket disconnected (code: ${code}, reason: ${reason.toString() || 'none'}). Reconnecting in 5s...`,
        );
        this.isWsConnected = false;
        this.stopWsHeartbeat();
        this.scheduleWsReconnect(5000);
      });
    } catch (err: any) {
      this.logger.error(`WebSocket initialization failed: ${err.message}`);
      this.scheduleWsReconnect(5000);
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

  private scheduleWsReconnect(delayMs = 5000) {
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    this.reconnectTimeout = setTimeout(() => {
      this.connectWebSocket();
    }, delayMs);
  }

  private disconnectWebSocket() {
    this.stopWsHeartbeat();
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
    this.isWsConnected = false;
  }

  private async handleWsMessage(rawData: WebSocket.RawData) {
    try {
      const text = rawData.toString();
      if (!text || text.trim() === '') return;

      const messageObj = JSON.parse(text);
      const eventType = messageObj.type || messageObj.event;
      const rawPayload = messageObj.payload;

      if (eventType === 'init') {
        this.logger.log(
          `⚡ WebSocket session established: ${rawPayload?.client_id || 'web-client'} (${rawPayload?.message || ''})`,
        );
        return;
      }

      if (eventType === 'gps_update' && rawPayload) {
        const busList: any[] = Array.isArray(rawPayload) ? rawPayload : [rawPayload];
        const batchPositions: any[] = [];
        const now = Date.now();

        for (const bus of busList) {
          const regNum = (bus.registration_number || bus.busReg || bus.vehicle_id || '').trim();
          const lat = parseFloat(bus.lat || bus.latitude);
          const lng = parseFloat(bus.lng || bus.longitude);

          // Strictly filter via production geofence and plate validation
          if (!isValidLmtBus(regNum, lat, lng, undefined, false)) {
            continue;
          }

          const routeCode = this.routeIdToCodeMap.get(bus.route_id) || (bus.route_code ? String(bus.route_code) : 'CM');
          const dirInt =
            typeof bus.direction_id === 'number'
              ? bus.direction_id
              : this.directionIdToIntMap.get(bus.direction_id) ?? (parseInt(String(bus.direction_id), 10) || 0);

          const timestampMs = bus.timestamp
            ? typeof bus.timestamp === 'number'
              ? bus.timestamp
              : new Date(bus.timestamp).getTime()
            : now;

          const prevPos = this.lastPositionMap.get(regNum);
          let computedSpeed = typeof bus.speed === 'number' ? bus.speed : 0;
          let computedBearing =
            typeof bus.bearing === 'number'
              ? bus.bearing
              : typeof bus.heading === 'number'
                ? bus.heading
                : 0;

          if (prevPos) {
            const distMeters = haversineMeters(prevPos.latitude, prevPos.longitude, lat, lng);
            const dtSec = (timestampMs - prevPos.timestamp) / 1000;
            if (dtSec > 0) {
              if (distMeters > 4.0) {
                computedSpeed = Math.round((distMeters / dtSec) * 3.6 * 10) / 10;
                computedBearing = calculateBearingDeg(prevPos.latitude, prevPos.longitude, lat, lng);
              } else {
                computedSpeed = prevPos.speed > 0 ? prevPos.speed : 15.0;
                computedBearing = prevPos.bearing;
              }
            } else {
              computedSpeed = prevPos.speed || 15.0;
              computedBearing = prevPos.bearing;
            }
          } else if (computedSpeed === 0) {
            computedSpeed = 18.0;
          }

          this.lastPositionMap.set(regNum, {
            latitude: lat,
            longitude: lng,
            timestamp: timestampMs,
            speed: computedSpeed,
            bearing: computedBearing,
          });

          const tripId = bus.trip_id || `LMT_${routeCode}_${dirInt}_${regNum}`;
          const hasCapacity =
            typeof bus.current_capacity === 'number' &&
            typeof bus.total_capacity === 'number' &&
            bus.total_capacity > 0;

          const occupancyPercentage = hasCapacity
            ? Math.round((bus.current_capacity / bus.total_capacity) * 100)
            : undefined;

          let occupancyStatus: string | undefined = undefined;
          if (occupancyPercentage !== undefined) {
            if (occupancyPercentage <= 0) occupancyStatus = 'EMPTY';
            else if (occupancyPercentage <= 50) occupancyStatus = 'MANY_SEATS_AVAILABLE';
            else if (occupancyPercentage <= 85) occupancyStatus = 'FEW_SEATS_AVAILABLE';
            else if (occupancyPercentage <= 100) occupancyStatus = 'STANDING_ROOM_ONLY';
            else occupancyStatus = 'FULL';
          }

          const vehicleLabel = hasCapacity
            ? `${regNum} (${Math.max(0, bus.total_capacity - bus.current_capacity)}/${bus.total_capacity} seats free)`
            : regNum;

          this.activeFleet.set(bus.bus_id || regNum, {
            bus_id: bus.bus_id || regNum,
            regNum,
            trip_id: tripId,
            route_id: routeCode,
            route_code: routeCode,
            direction_id: dirInt,
            lastTicketTime: timestampMs,
            latitude: lat,
            longitude: lng,
          });

          batchPositions.push({
            trip_id: tripId,
            route_id: routeCode,
            direction_id: dirInt,
            vehicle_id: regNum,
            vehicle_label: vehicleLabel,
            license_plate: regNum,
            latitude: lat,
            longitude: lng,
            speed: computedSpeed,
            bearing: computedBearing,
            occupancy_status: occupancyStatus,
            occupancy_percentage: occupancyPercentage,
            capacity_current: typeof bus.current_capacity === 'number' ? bus.current_capacity : undefined,
            capacity_total: typeof bus.total_capacity === 'number' ? bus.total_capacity : undefined,
            timestamp: new Date(timestampMs).toISOString(),
          });
        }

        // Evict vehicles inactive for > 45 minutes
        const evictionThreshold = now - 45 * 60 * 1000;
        for (const [busId, bus] of this.activeFleet.entries()) {
          if (bus.lastTicketTime < evictionThreshold) {
            this.activeFleet.delete(busId);
            this.lastPositionMap.delete(bus.regNum);
          }
        }

        if (batchPositions.length > 0) {
          this.lastPollTimestamp = Date.now();
          await this.publisher.publishVehiclePositionsBatch(batchPositions);
          this.logger.log(
            `⚡ Ingested real-time WebSocket telemetry for ${batchPositions.length} active buses (total fleet: ${this.activeFleet.size})`,
          );
        }
      }
    } catch (err: any) {
      this.logger.error(`Error processing WebSocket message: ${err.message}`);
    }
  }
}
