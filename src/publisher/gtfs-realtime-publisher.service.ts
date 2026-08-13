import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { CreateVehiclePositionDto } from './dto/vehicle-position.dto';

@Injectable()
export class GtfsRealtimePublisherService {
  private readonly logger = new Logger(GtfsRealtimePublisherService.name);

  private getBaseUrl(): string {
    return (
      process.env.TRANSIT_SERVER_URL ||
      process.env.RAILWAY_PRIVATE_DOMAIN
        ? `http://${process.env.RAILWAY_PRIVATE_DOMAIN}:3000/api/v1`
        : 'http://slr-transit-server.railway.internal:3000/api/v1'
    );
  }

  async publishVehiclePosition(dto: CreateVehiclePositionDto): Promise<boolean> {
    const baseUrl = this.getBaseUrl();
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

      this.logger.log(`Published VehiclePosition [${dto.vehicle_id || dto.trip_id}] via Private Net -> (${dto.latitude.toFixed(4)}, ${dto.longitude.toFixed(4)})`);
      return true;
    } catch (err: any) {
      // Fallback to public domain if private networking is unresolvable locally
      if (baseUrl.includes('railway.internal')) {
        return this.publishVehiclePositionPublicFallback(dto);
      }
      this.logger.error(`Failed to publish VehiclePosition for ${dto.vehicle_id || dto.trip_id}: ${err.message}`);
      return false;
    }
  }

  private async publishVehiclePositionPublicFallback(dto: CreateVehiclePositionDto): Promise<boolean> {
    const fallbackUrl = 'https://api.transit.seyone.dev/api/v1/realtime/vehicle-positions';
    const apiKey = process.env.TRANSIT_API_KEY || 'super-secret-key';

    try {
      await axios.post(fallbackUrl, dto, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'x-api-key': apiKey,
        },
        timeout: 5000,
      });
      return true;
    } catch (err: any) {
      this.logger.error(`Fallback VehiclePosition publish failed: ${err.message}`);
      return false;
    }
  }

  async publishAgency(data: any): Promise<boolean> {
    return this.postToCrudEndpoint('/agency', data);
  }

  async publishAttribution(data: any): Promise<boolean> {
    return this.postToCrudEndpoint('/attribution', data);
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

  async publishFareAttribute(data: any): Promise<boolean> {
    return this.postToCrudEndpoint('/fare-attributes', data);
  }

  async publishFareRule(data: any): Promise<boolean> {
    return this.postToCrudEndpoint('/fare-rules', data);
  }

  async publishAlert(data: any): Promise<boolean> {
    return this.postToCrudEndpoint('/realtime/alerts', data);
  }

  private async postToCrudEndpoint(endpoint: string, payload: any): Promise<boolean> {
    const baseUrl = this.getBaseUrl();
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
      // Retry via public domain fallback if private networking is unresolvable locally
      if (baseUrl.includes('railway.internal')) {
        const fallbackUrl = `https://api.transit.seyone.dev/api/v1${endpoint}`;
        try {
          await axios.post(fallbackUrl, payload, {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`,
              'x-api-key': apiKey,
            },
            timeout: 10000,
          });
          return true;
        } catch (fallbackErr: any) {
          this.logger.warn(`Failed to post to CRUD ${endpoint}: ${fallbackErr.message}`);
          return false;
        }
      }
      this.logger.warn(`Failed to post to CRUD ${endpoint}: ${err.message}`);
      return false;
    }
  }
}
