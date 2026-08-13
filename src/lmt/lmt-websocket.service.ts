import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import WebSocket from 'ws';
import axios from 'axios';
import { GtfsRealtimePublisherService } from '../publisher/gtfs-realtime-publisher.service';
import { TokenProviderService } from '../auth/token-provider.service';

interface ScheduleAssignment {
  trip_id: string;
  route_id: string;
  bus_id: string;
}

@Injectable()
export class LmtWebsocketService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LmtWebsocketService.name);
  private ws: WebSocket | null = null;
  private pingInterval: NodeJS.Timeout | null = null;
  private pollInterval: NodeJS.Timeout | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private isConnected = false;

  private assignmentMap = new Map<string, ScheduleAssignment>();
  private activeBusUUIDs = new Map<string, { bus_id: string; regNum: string; trip_id: string; route_id: string }>();
  private lastAssignmentFetch = 0;

  constructor(
    private readonly publisher: GtfsRealtimePublisherService,
    private readonly tokenProvider: TokenProviderService,
  ) {}

  onModuleInit() {
    this.connect();
    this.startMobileTrackingPolling();
  }

  onModuleDestroy() {
    this.disconnect();
  }

  public getIsConnected(): boolean {
    return this.isConnected;
  }

  private async refreshScheduleAssignmentsIfNeeded() {
    const now = Date.now();
    if (now - this.lastAssignmentFetch < 15 * 60 * 1000 && this.assignmentMap.size > 0) {
      return;
    }

    try {
      const token = await this.tokenProvider.getOrRefreshToken();
      const headers = { Authorization: `Bearer ${token}` };
      const todayStr = new Date().toISOString().split('T')[0];
      const routeIds = [
        '8bc594e3-8ad6-4a0d-9138-bf8b4247e2f5',
        'f3eaf277-a6fa-4f5b-8a61-3b1758d9a4b8',
      ];

      this.activeBusUUIDs.clear();

      for (const routeId of routeIds) {
        const resp = await axios.get(
          `https://lankametro.lk/metrobus-proxy/ticketing-service/api/v1/bus-schedule-assignments/daily-schedule?date=${todayStr}&route_id=${routeId}`,
          { headers, timeout: 5000 },
        );
        const schedules = resp.data?.data?.schedules || [];
        for (const sched of schedules) {
          const slots = sched.slots || [];
          for (const slot of slots) {
            const regNum = slot.bus?.registration_number;
            const busId = slot.bus?.bus_id;
            const tripId = String(slot.slot_id || `TRIP_${sched.code}_${slot.slot_number}`);
            if (regNum && busId) {
              this.assignmentMap.set(regNum, {
                trip_id: tripId,
                route_id: routeId,
                bus_id: busId,
              });
              this.activeBusUUIDs.set(busId, {
                bus_id: busId,
                regNum,
                trip_id: tripId,
                route_id: routeId,
              });
            }
          }
        }
      }
      this.lastAssignmentFetch = now;
      this.logger.log(`✅ Refreshed ${this.assignmentMap.size} bus schedule assignments & ${this.activeBusUUIDs.size} active bus UUIDs.`);
    } catch (err: any) {
      this.logger.warn(`Could not refresh schedule assignments: ${err.message}`);
    }
  }

  private startMobileTrackingPolling() {
    if (this.pollInterval) clearInterval(this.pollInterval);

    // Poll Mobile App tracking endpoint every 5 seconds for ultra-crisp real-time updates
    this.pollInterval = setInterval(async () => {
      await this.pollMobileAppBusTracking();
    }, 5000);
  }

  private async pollMobileAppBusTracking() {
    await this.refreshScheduleAssignmentsIfNeeded();
    if (this.activeBusUUIDs.size === 0) return;

    try {
      const token = await this.tokenProvider.getOrRefreshToken();
      const headers = {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'okhttp/4.10.0',
        Accept: 'application/json',
      };

      for (const [busId, busInfo] of this.activeBusUUIDs.entries()) {
        try {
          const url = `https://lankametro.lk/metrobus-proxy/ticketing-service/api/v1/buses/${busId}/tracking`;
          const resp = await axios.get(url, { headers, timeout: 3500 });

          if (resp.status === 200 && resp.data?.data) {
            const trackData = resp.data.data;
            const loc = trackData.bus_location;
            const status = trackData.status;

            if (loc && typeof loc.lat === 'number' && typeof loc.lng === 'number') {
              const delayMins = parseFloat(trackData.delay_minutes || 0);
              const delaySecs = Math.round(delayMins * 60);

              this.logger.log(
                `📱 [MOBILE APP TRACKING] Bus ${busInfo.regNum} (${busInfo.trip_id.slice(0, 10)}) Status: ${status} -> (${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}), Delay: ${delayMins}m`,
              );

              // Publish real-time vehicle position
              await this.publisher.publishVehiclePosition({
                trip_id: busInfo.trip_id,
                route_id: busInfo.route_id,
                direction_id: 0,
                vehicle_id: busInfo.regNum,
                vehicle_label: busInfo.regNum,
                license_plate: busInfo.regNum,
                latitude: loc.lat,
                longitude: loc.lng,
                speed: 0,
                bearing: 0,
                timestamp: loc.recorded_at ? new Date(loc.recorded_at).toISOString() : new Date().toISOString(),
              });
            }
          }
        } catch {
          // Ignore individual 400 (inactive session) or 404 responses quietly
        }
      }
    } catch (err: any) {
      this.logger.warn(`Mobile tracking polling error: ${err.message}`);
    }
  }

  private async connect(forceTokenRefresh = false) {
    const wsUrl = process.env.LMT_WS_URL || 'wss://metrobusapiprod.eimsky.com/ticketing-service/ws';
    let token = '';

    try {
      token = await this.tokenProvider.getOrRefreshToken(forceTokenRefresh);
    } catch (err: any) {
      this.logger.error(`Failed to acquire valid JWT token: ${err.message}`);
      this.scheduleReconnect(10000);
      return;
    }

    const fullUrl = token ? `${wsUrl}?token=${token}` : wsUrl;
    this.logger.log(`Connecting to SmartMetro WebSocket stream...`);

    try {
      this.ws = new WebSocket(fullUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Origin': 'https://lankametro.lk',
        },
      });

      this.ws.on('open', () => {
        this.logger.log('⚡ Connected successfully to SmartMetro WebSocket stream!');
        this.isConnected = true;
        this.startHeartbeat();
        this.refreshScheduleAssignmentsIfNeeded().catch(() => {});
      });

      this.ws.on('message', (data: WebSocket.RawData) => {
        this.handleMessage(data);
      });

      this.ws.on('error', (err) => {
        this.logger.error(`SmartMetro WebSocket error: ${err.message}`);
      });

      this.ws.on('close', (code, reason) => {
        this.logger.warn(`SmartMetro WebSocket closed [Code: ${code}, Reason: ${reason.toString() || 'None'}]`);
        this.isConnected = false;
        this.stopHeartbeat();

        const isAuthError = code === 401 || code === 1006 || reason.toString().includes('401');
        this.scheduleReconnect(5000, isAuthError);
      });
    } catch (err: any) {
      this.logger.error(`Failed to create WebSocket instance: ${err.message}`);
      this.scheduleReconnect(5000, true);
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, 15000);
  }

  private stopHeartbeat() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private scheduleReconnect(delayMs = 5000, forceTokenRefresh = false) {
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    this.logger.log(`Scheduling WebSocket reconnect in ${delayMs / 1000}s (forceTokenRefresh=${forceTokenRefresh})...`);
    this.reconnectTimeout = setTimeout(() => {
      this.connect(forceTokenRefresh);
    }, delayMs);
  }

  private disconnect() {
    this.stopHeartbeat();
    if (this.pollInterval) clearInterval(this.pollInterval);
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }

  private async handleMessage(rawData: WebSocket.RawData) {
    try {
      const text = rawData.toString();
      if (!text || text.trim() === '') return;

      const messageObj = JSON.parse(text);
      const eventType = messageObj.type || messageObj.event || messageObj.action;
      const rawPayload = messageObj.payload || messageObj.data;

      if (eventType === 'gps_update' && rawPayload) {
        await this.refreshScheduleAssignmentsIfNeeded();
        const busList: any[] = Array.isArray(rawPayload) ? rawPayload : [rawPayload];

        for (const bus of busList) {
          const regNum = bus.registration_number || bus.busReg || bus.vehicle_id || 'UNKNOWN_BUS';
          const lat = parseFloat(bus.lat || bus.latitude);
          const lng = parseFloat(bus.lng || bus.longitude);

          if (!isNaN(lat) && !isNaN(lng)) {
            const assignment = this.assignmentMap.get(regNum);
            const tripId = assignment?.trip_id || (bus.route_id ? `TRIP_${bus.route_id.slice(0, 8)}` : `BUS_${regNum}`);
            const routeId = assignment?.route_id || bus.route_id || undefined;
            const dirInt = typeof bus.direction_id === 'number' ? bus.direction_id : (bus.direction_id ? parseInt(String(bus.direction_id), 10) || 0 : 0);

            this.publisher.publishVehiclePosition({
              trip_id: tripId,
              route_id: routeId,
              direction_id: dirInt,
              vehicle_id: regNum,
              vehicle_label: regNum,
              license_plate: regNum,
              latitude: lat,
              longitude: lng,
              speed: isNaN(parseFloat(bus.speed)) ? 0 : parseFloat(bus.speed),
              bearing: isNaN(parseFloat(bus.bearing || bus.heading)) ? 0 : parseFloat(bus.bearing || bus.heading),
              timestamp: new Date(typeof bus.timestamp === 'number' ? bus.timestamp : Date.now()).toISOString(),
            });
          }
        }
      } else if (eventType === 'init') {
        this.logger.log(`Received SmartMetro init framing: ${JSON.stringify(rawPayload)}`);
      }
    } catch (err: any) {
      this.logger.error(`Error processing SmartMetro WebSocket message: ${err.message}`);
    }
  }
}
