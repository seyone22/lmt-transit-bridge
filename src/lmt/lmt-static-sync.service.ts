import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import axios from 'axios';
import { GtfsRealtimePublisherService } from '../publisher/gtfs-realtime-publisher.service';
import { TokenProviderService } from '../auth/token-provider.service';

@Injectable()
export class LmtStaticSyncService implements OnModuleInit {
  private readonly logger = new Logger(LmtStaticSyncService.name);

  constructor(
    private readonly publisher: GtfsRealtimePublisherService,
    private readonly tokenProvider: TokenProviderService,
  ) {}

  async onModuleInit() {
    this.logger.log('🚀 Initializing LMT Static GTFS Ingestion Service in Bridge...');
    // Run an initial sync asynchronously in the background so app startup is not blocked
    this.syncStaticGtfsScheduleData().catch((err) => {
      this.logger.error(`Initial static GTFS sync error: ${err.message}`);
    });
  }

  /**
   * Weekly Cron Trigger: Every Sunday at Midnight UTC (5:30 AM IST)
   */
  @Cron(CronExpression.EVERY_WEEK)
  async handleWeeklySync() {
    this.logger.log('⏰ Executing Scheduled Weekly Static GTFS Schedule Ingestion...');
    await this.syncStaticGtfsScheduleData();
  }

  async syncStaticGtfsScheduleData(): Promise<void> {
    this.logger.log('📥 Fetching Upstream LMT Go Static Schedule Data & GeoJSON Shapes...');

    try {
      const token = await this.tokenProvider.getOrRefreshToken();
      const headers = {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'okhttp/4.10.0',
        Accept: 'application/json',
      };

      // 1. Sync Agency Metadata
      await this.publisher.publishAgency({
        agency_id: 'LMT',
        agency_name: 'LANKA METRO TRANSIT PVT LTD',
        agency_url: 'https://lankametro.lk',
        agency_timezone: 'Asia/Colombo',
        agency_lang: 'en',
        agency_phone: '0702886886',
        agency_email: 'info@lankametro.lk',
      });
      this.logger.log('✅ Agency [LMT] synced to server.');

      // 2. Fetch GeoJSON Shape Waypoints
      const geoRes = await axios.get(
        'https://lankametro.lk/gcs-proxy/artwork_storage_dev/new-release/v7-Forward-M-K.geojson',
        { timeout: 10000 },
      );
      if (geoRes.status === 200 && geoRes.data) {
        const lineFeature = geoRes.data.features?.find(
          (f: any) => f.geometry?.type === 'LineString' || f.geometry?.type === 'MultiLineString',
        );

        if (lineFeature && lineFeature.geometry?.coordinates) {
          const coords: number[][] = lineFeature.geometry.coordinates;
          this.logger.log(`📌 Ingesting ${coords.length} GeoJSON shape waypoints...`);

          for (let i = 0; i < coords.length; i += 50) {
            const chunk = coords.slice(i, i + 50);
            await Promise.all(
              chunk.map((c, idx) =>
                this.publisher.publishShape({
                  shape_id: 'SHAPE_CM01',
                  shape_pt_lat: c[1],
                  shape_pt_lon: c[0],
                  shape_pt_sequence: i + idx + 1,
                }),
              ),
            );
          }
          this.logger.log('✅ Route shape waypoints ingested.');
        }
      }

      // 3. Fetch Master Routes & Directional Stops
      const lmtRouteUUIDs = [
        {
          route_id: '8bc594e3-8ad6-4a0d-9138-bf8b4247e2f5',
          code: 'CM01',
          name: 'CM01 (Makumbura - Maharagama - Borella - Kadawatha)',
          color: '1A5A96',
          shape_id: 'SHAPE_CM01',
        },
        {
          route_id: 'f3eaf277-a6fa-4f5b-8a61-3b1758d9a4b8',
          code: 'CM02',
          name: 'CM02 (Makumbura - Rajagiriya - Fort Express)',
          color: 'EDBF23',
          shape_id: 'SHAPE_CM02',
        },
      ];

      for (const r of lmtRouteUUIDs) {
        await this.publisher.publishRoute({
          route_id: r.route_id,
          agency_id: 'LMT',
          route_short_name: r.code,
          route_long_name: r.name,
          route_type: 3,
          route_color: r.color,
          route_text_color: 'FFFFFF',
        });
      }
      this.logger.log('✅ Bus routes [CM01, CM02] synced to server.');

      this.logger.log('🎉 Static GTFS Schedule Ingestion Complete!');
    } catch (err: any) {
      this.logger.error(`Error during Static GTFS Ingestion: ${err.message}`);
    }
  }
}
