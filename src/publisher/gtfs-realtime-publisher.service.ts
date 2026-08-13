import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { CreateVehiclePositionDto } from './dto/vehicle-position.dto';

@Injectable()
export class GtfsRealtimePublisherService {
  private readonly logger = new Logger(GtfsRealtimePublisherService.name);

  async publishVehiclePosition(dto: CreateVehiclePositionDto): Promise<boolean> {
    const baseUrl = process.env.TRANSIT_SERVER_URL || 'https://slr-transit-server-production.up.railway.app/api/v1';
    const apiKey = process.env.TRANSIT_API_KEY || 'super-secret-key';

    try {
      await axios.post(`${baseUrl}/realtime/vehicle-positions`, dto, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'x-api-key': apiKey,
        },
        timeout: 5000,
      });

      this.logger.log(`Published VehiclePosition [${dto.vehicle_id || dto.trip_id}] -> (${dto.latitude.toFixed(4)}, ${dto.longitude.toFixed(4)})`);
      return true;
    } catch (err: any) {
      this.logger.error(`Failed to publish VehiclePosition for ${dto.vehicle_id || dto.trip_id}: ${err.message}`);
      return false;
    }
  }

  async publishAgency(data: any): Promise<boolean> {
    return this.postToCrudEndpoint('/agency', data);
  }

  async publishRoute(data: any): Promise<boolean> {
    return this.postToCrudEndpoint('/routes', data);
  }

  async publishStop(data: any): Promise<boolean> {
    return this.postToCrudEndpoint('/stops', data);
  }

  async publishShape(data: any): Promise<boolean> {
    return this.postToCrudEndpoint('/shapes', data);
  }

  async publishTrip(data: any): Promise<boolean> {
    return this.postToCrudEndpoint('/trips', data);
  }

  async publishStopTime(data: any): Promise<boolean> {
    return this.postToCrudEndpoint('/stop-times', data);
  }

  private async postToCrudEndpoint(endpoint: string, payload: any): Promise<boolean> {
    const baseUrl = process.env.TRANSIT_SERVER_URL || 'https://api.transit.seyone.dev/api/v1';
    const apiKey = process.env.TRANSIT_API_KEY || 'super-secret-key';

    try {
      await axios.post(`${baseUrl}${endpoint}`, payload, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'x-api-key': apiKey,
        },
        timeout: 10000,
      });
      return true;
    } catch (err: any) {
      this.logger.warn(`Failed to post to CRUD ${endpoint}: ${err.message}`);
      return false;
    }
  }
}
