import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import WebSocket from 'ws';
import { GtfsRealtimePublisherService } from '../publisher/gtfs-realtime-publisher.service';
import { TokenProviderService } from '../auth/token-provider.service';

@Injectable()
export class LmtWebsocketService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LmtWebsocketService.name);
  private ws: WebSocket | null = null;
  private pingInterval: NodeJS.Timeout | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private isConnected = false;

  constructor(
    private readonly publisher: GtfsRealtimePublisherService,
    private readonly tokenProvider: TokenProviderService,
  ) {}

  onModuleInit() {
    this.connect();
  }

  onModuleDestroy() {
    this.disconnect();
  }

  public getIsConnected(): boolean {
    return this.isConnected;
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

        // If closed with 401 / 1006 auth failure, force token refresh on reconnect
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
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }

  private handleMessage(rawData: WebSocket.RawData) {
    try {
      const text = rawData.toString();
      if (!text || text.trim() === '') return;

      const messageObj = JSON.parse(text);
      const eventType = messageObj.type || messageObj.event || messageObj.action;
      const rawPayload = messageObj.payload || messageObj.data;

      if (eventType === 'gps_update' && rawPayload) {
        const busList: any[] = Array.isArray(rawPayload) ? rawPayload : [rawPayload];

        for (const bus of busList) {
          const regNum = bus.registration_number || bus.busReg || bus.vehicle_id || 'UNKNOWN_BUS';
          const lat = parseFloat(bus.lat || bus.latitude);
          const lng = parseFloat(bus.lng || bus.longitude);

          if (!isNaN(lat) && !isNaN(lng)) {
            const tripId = bus.route_id ? `TRIP_${bus.route_id.slice(0, 8)}` : `BUS_${regNum}`;
            const speed = parseFloat(bus.speed || 0);
            const bearing = parseFloat(bus.bearing || bus.heading || 0);
            const tsMs = typeof bus.timestamp === 'number' ? bus.timestamp : Date.now();

            this.publisher.publishVehiclePosition({
              trip_id: tripId,
              vehicle_id: regNum,
              vehicle_label: regNum,
              license_plate: regNum,
              latitude: lat,
              longitude: lng,
              speed: isNaN(speed) ? 0 : speed,
              bearing: isNaN(bearing) ? 0 : bearing,
              timestamp: new Date(tsMs).toISOString(),
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
