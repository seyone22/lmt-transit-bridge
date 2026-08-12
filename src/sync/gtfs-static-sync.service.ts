import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
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
      const token = await this.tokenProvider.getOrRefreshToken();
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://lankametro.lk/en/smartmetro',
        'Authorization': `Bearer ${token}`,
      };

      // 1. Fetch active routes
      let routesProcessed = 0;
      try {
        const routesRes = await axios.get(
          'https://lankametro.lk/metrobus-proxy/fare-service/api/v1/routes/get-all-active-routes-by-search?search=',
          { headers, timeout: 10000 },
        );
        const routes = routesRes.data?.data || routesRes.data || [];
        routesProcessed = Array.isArray(routes) ? routes.length : 0;
        this.logger.log(`Fetched ${routesProcessed} active routes from SmartMetro gateway.`);
      } catch (err: any) {
        this.logger.warn(`Could not fetch active routes directly: ${err.message}`);
      }

      // 2. Trigger slr-transit-server to regenerate gtfs.zip on S3
      const transitServerUrl = process.env.TRANSIT_SERVER_URL || 'https://slr-transit-server-production.up.railway.app/api/v1';
      const apiKey = process.env.TRANSIT_API_KEY || 'super-secret-token';

      try {
        await axios.get(`${transitServerUrl}/gtfs/download`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          timeout: 15000,
        });
        this.logger.log('⚡ Triggered slr-transit-server gtfs.zip regeneration & S3 upload successfully!');
      } catch (err: any) {
        this.logger.warn(`Failed to trigger slr-transit-server GTFS download refresh: ${err.message}`);
      }

      this.logger.log('✅ GTFS Static Data Sync completed successfully!');
      return {
        success: true,
        message: 'GTFS Static Data Sync completed successfully.',
        routesProcessed,
      };
    } catch (err: any) {
      this.logger.error(`Error during GTFS Static Data Sync: ${err.message}`);
      return { success: false, message: `Sync failed: ${err.message}` };
    } finally {
      this.isSyncing = false;
    }
  }
}
