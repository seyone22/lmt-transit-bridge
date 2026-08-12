import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import WebSocket from 'ws';
import { GtfsRealtimePublisherService } from '../publisher/gtfs-realtime-publisher.service';

@Injectable()
export class LmtWebsocketService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LmtWebsocketService.name);
  private ws: WebSocket | null = null;
  private pingInterval: NodeJS.Timeout | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private isConnected = false;

  constructor(private readonly publisher: GtfsRealtimePublisherService) {}

  onModuleInit() {
    this.connect();
  }

  onModuleDestroy() {
    this.disconnect();
  }

  public getIsConnected(): boolean {
    return this.isConnected;
  }

  private connect() {
    const wsUrl = process.env.LMT_WS_URL || 'wss://metrobusapiprod.eimsky.com/ticketing-service/ws';
    const token = process.env.LMT_WS_TOKEN || '';
    const fullUrl = token ? `${wsUrl}?token=${token}` : wsUrl;

    this.logger.log(`Connecting to SmartMetro WebSocket: ${wsUrl}`);

    try {
      this.ws = new WebSocket(fullUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Origin': 'https://lankametro.lk',
        },
      });

      this.ws.on('open', () => {
        this.logger.log('Connected successfully to SmartMetro WebSocket');
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
        this.scheduleReconnect();
      });
    } catch (err: any) {
      this.logger.error(`Failed to create WebSocket instance: ${err.message}`);
      this.scheduleReconnect();
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

  private scheduleReconnect(delayMs = 5000) {
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    this.logger.log(`Scheduling WebSocket reconnect in ${delayMs / 1000}s...`);
    this.reconnectTimeout = setTimeout(() => {
      this.connect();
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

      const payload = JSON.parse(text);
      this.logger.debug(`Received WS payload: ${text.slice(0, 150)}`);

      // SmartMetro WebSocket event types: 'gps_update', 'location_update', etc.
      const eventType = payload.type || payload.event || payload.action;
      const data = payload.data || payload.payload || payload;

      if (data && (data.busReg || data.vehicleId || data.lat)) {
        const busReg = data.busReg || data.vehicleId || data.bus_reg || 'UNKNOWN_BUS';
        const lat = parseFloat(data.lat || data.latitude);
        const lng = parseFloat(data.lng || data.longitude);

        if (!isNaN(lat) && !isNaN(lng)) {
          const tripId = data.tripId || data.trip_id || `BUS_${busReg}`;
          const speed = parseFloat(data.speed || 0);
          const bearing = parseFloat(data.bearing || data.heading || 0);
          const timestamp = data.timestamp ? new Date(data.timestamp).toISOString() : new Date().toISOString();

          this.publisher.publishVehiclePosition({
            trip_id: tripId,
            vehicle_id: busReg,
            vehicle_label: busReg,
            license_plate: busReg,
            latitude: lat,
            longitude: lng,
            speed: isNaN(speed) ? 0 : speed,
            bearing: isNaN(bearing) ? 0 : bearing,
            timestamp,
          });
        }
      }
    } catch (err: any) {
      this.logger.error(`Error parsing WebSocket message: ${err.message}`);
    }
  }
}
