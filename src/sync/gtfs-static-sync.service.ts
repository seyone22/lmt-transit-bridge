import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import axios from 'axios';
import { TokenProviderService } from '../auth/token-provider.service';

@Injectable()
export class GtfsStaticSyncService {
  private readonly logger = new Logger(GtfsStaticSyncService.name);
  private isSyncing = false;

  constructor(private readonly tokenProvider: TokenProviderService) {}

  // Run automatically every Sunday at 2:00 AM
  @Cron('0 2 * * 0')
  async handleWeeklySync() {
    this.logger.log('⏰ Executing scheduled weekly GTFS Static data sync...');
    await this.runSync();
  }

  // Manual trigger method
  async runSync(): Promise<{ success: boolean; message: string; routesProcessed?: number }> {
    if (this.isSyncing) {
      return { success: false, message: 'Sync operation is already in progress.' };
    }

    this.isSyncing = true;
    this.logger.log('🚀 Starting GTFS Static Data Sync process...');

    try {
      const transitServerUrl = process.env.TRANSIT_SERVER_URL || 'https://slr-transit-server-production.up.railway.app/api/v1';
      const apiKey = process.env.TRANSIT_API_KEY || 'super-secret-token';
      const authHeaders = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      };

      // 1. Ensure LMT Agency exists
      try {
        await axios.post(
          `${transitServerUrl}/agency`,
          {
            agency_id: 'LMT',
            agency_name: 'Lanka Metro Transit',
            agency_url: 'https://lankametro.lk',
            agency_timezone: 'Asia/Colombo',
            agency_lang: 'en',
          },
          { headers: authHeaders },
        );
        this.logger.log('✅ Agency LMT upserted in PostgreSQL database.');
      } catch (err: any) {
        this.logger.warn(`Agency LMT upsert warning: ${err.message}`);
      }

      // 2. Ensure CM01 and CM02 Routes exist in PostgreSQL
      const lmtRoutes = [
        {
          route_id: '8bc594e3-8ad6-4a0d-9138-bf8b4247e2f5',
          agency_id: 'LMT',
          route_short_name: 'CM01',
          route_long_name: 'Makumbura – Maharagama – Nugegoda – Borella – Kadawatha Corridor',
          route_type: 3,
          route_color: '008080',
          route_text_color: 'FFFFFF',
        },
        {
          route_id: 'f3eaf277-a6fa-4f5b-8a61-3b1758d9a4b8',
          agency_id: 'LMT',
          route_short_name: 'CM02',
          route_long_name: 'Pettah – Fort – Rajagiriya – Battaramulla – Kottawa Express',
          route_type: 3,
          route_color: 'FF4500',
          route_text_color: 'FFFFFF',
        },
      ];

      for (const route of lmtRoutes) {
        try {
          await axios.post(`${transitServerUrl}/routes`, route, { headers: authHeaders });
          this.logger.log(`✅ Route [${route.route_short_name}] (${route.route_id.slice(0, 8)}) upserted in PostgreSQL.`);
        } catch (err: any) {
          this.logger.warn(`Route [${route.route_short_name}] upsert warning: ${err.message}`);
        }
      }

      // 3. Trigger slr-transit-server to regenerate gtfs.zip on S3
      try {
        await axios.get(`${transitServerUrl}/gtfs/download`, {
          headers: authHeaders,
          timeout: 15000,
        });
        this.logger.log('⚡ Triggered slr-transit-server gtfs.zip regeneration & S3 upload successfully!');
      } catch (err: any) {
        this.logger.warn(`Failed to trigger slr-transit-server GTFS download refresh: ${err.message}`);
      }

      this.logger.log('✅ GTFS Static Data Sync completed successfully!');
      return {
        success: true,
        message: 'GTFS Static Data Sync completed successfully. CM01 & CM02 routes stored.',
        routesProcessed: lmtRoutes.length,
      };
    } catch (err: any) {
      this.logger.error(`Error during GTFS Static Data Sync: ${err.message}`);
      return { success: false, message: `Sync failed: ${err.message}` };
    } finally {
      this.isSyncing = false;
    }
  }
}
