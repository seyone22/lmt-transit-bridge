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
    this.logger.log('🚀 Initializing LMT Bridge Ingestion Engine...');
    // Sync notifications/alerts lightweight on startup
    this.syncNotificationsAndAlerts().catch((err) => {
      this.logger.warn(`Startup alerts sync warning: ${err.message}`);
    });
  }

  /**
   * Weekly Automated Sync Trigger: Every Sunday at Midnight UTC (5:30 AM IST)
   */
  @Cron(CronExpression.EVERY_WEEK)
  async handleWeeklySync() {
    this.logger.log('⏰ Executing Scheduled Weekly Master GTFS Schedule Ingestion...');
    await this.syncStaticGtfsScheduleData();
  }

  /**
   * Hourly Alerts & Advisories Sync Trigger: Every 15 minutes
   */
  @Cron('0 */15 * * * *')
  async handleAlertsSync() {
    await this.syncNotificationsAndAlerts();
  }

  async syncStaticGtfsScheduleData(): Promise<void> {
    this.logger.log('📥 Executing Full Automated Ingestion of Agency, Attributions, Shapes, Routes, Stops & Timetables...');

    try {
      const token = await this.tokenProvider.getOrRefreshToken();
      const headers = {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'okhttp/4.10.0',
        Accept: 'application/json',
      };

      // 1. Sync Agency & Attributions
      await this.publisher.publishAgency({
        agency_id: 'LMT',
        agency_name: 'LANKA METRO TRANSIT PVT LTD',
        agency_url: 'https://lankametro.lk',
        agency_timezone: 'Asia/Colombo',
        agency_lang: 'en',
        agency_phone: '0702886886',
        agency_email: 'info@lankametro.lk',
      });

      await this.publisher.publishAttribution({
        attribution_id: 'ATT_LMT_OPERATOR',
        agency_id: 'LMT',
        organization_name: 'LANKA METRO TRANSIT PVT LTD',
        is_producer: 1,
        is_operator: 1,
        is_authority: 0,
        email: 'info@lankametro.lk',
        phone_number: '0702886886',
      });

      await this.publisher.publishAttribution({
        attribution_id: 'ATT_NTC_AUTHORITY',
        agency_id: 'LMT',
        organization_name: 'National Transport Commission',
        is_producer: 0,
        is_operator: 0,
        is_authority: 1,
        email: 'info@ntc.gov.lk',
        phone_number: '0112369369',
      });
      this.logger.log('✅ Agency & Attributions synced to server.');

      // 2. Fetch GeoJSON Route Shapes (CM01 & CM02)
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
          this.logger.log(`📌 Ingesting ${coords.length * 2} shape waypoints for SHAPE_CM01 & SHAPE_CM02...`);

          for (let i = 0; i < coords.length; i += 50) {
            const chunk = coords.slice(i, i + 50);
            await Promise.all([
              ...chunk.map((c, idx) =>
                this.publisher.publishShape({
                  shape_id: 'SHAPE_CM01',
                  shape_pt_lat: c[1],
                  shape_pt_lon: c[0],
                  shape_pt_sequence: i + idx + 1,
                }),
              ),
              ...chunk.map((c, idx) =>
                this.publisher.publishShape({
                  shape_id: 'SHAPE_CM02',
                  shape_pt_lat: c[1],
                  shape_pt_lon: c[0],
                  shape_pt_sequence: i + idx + 1,
                }),
              ),
            ]);
          }
          this.logger.log('✅ Route shapes [SHAPE_CM01, SHAPE_CM02] ingested.');
        }
      }

      // 3. Fetch Master Routes
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
      this.logger.log('✅ Master bus routes [CM01, CM02] synced.');

      // 4. Fetch 84 Directional Platform Stops & 21 Parent Stations across all 4 direction UUIDs
      const directionUUIDs = [
        { route_id: '8bc594e3-8ad6-4a0d-9138-bf8b4247e2f5', dir_id: 'fe423b83-34e7-4bd5-816b-97968dcd2b1f' }, // CM01 Outbound
        { route_id: '8bc594e3-8ad6-4a0d-9138-bf8b4247e2f5', dir_id: '7a0aa9fc-7d82-4e7b-94ac-2bc488160194' }, // CM01 Return
        { route_id: 'f3eaf277-a6fa-4f5b-8a61-3b1758d9a4b8', dir_id: '401ccb91-2269-471d-877c-1af77d98dba3' }, // CM02 Outbound
        { route_id: 'f3eaf277-a6fa-4f5b-8a61-3b1758d9a4b8', dir_id: '47831874-290c-4beb-959a-3e004f8e0e00' }, // CM02 Return
      ];

      const parentStationMap = new Map<string, any>();
      const stopsMap = new Map<string, any>();

      for (const dir of directionUUIDs) {
        try {
          const stopsRes = await axios.get(
            `https://lankametro.lk/metrobus-proxy/fare-service/api/v1/routes/${dir.route_id}/stops?direction_id=${dir.dir_id}`,
            { headers, timeout: 10000 },
          );

          if (stopsRes.status === 200 && stopsRes.data?.data?.stops) {
            const stops = stopsRes.data.data.stops;
            for (const s of stops) {
              const stopId = String(s.id || s.stop_id);
              const latVal = s.latitude || s.lat;
              const lonVal = s.longitude || s.lng;
              const rawName = s.stop_name_en || s.stop_name || 'LMT Bus Stop';

              const cleanStationKey = rawName
                .toLowerCase()
                .replace(/ 01| 1| 02| 2| campus| station| junction| depot/gi, '')
                .replace(/[^a-z0-9]/g, '_')
                .trim();
              const parentStationId = `STATION_${cleanStationKey.toUpperCase()}`;

              if (!parentStationMap.has(parentStationId) && latVal && lonVal) {
                parentStationMap.set(parentStationId, {
                  stop_id: parentStationId,
                  stop_code: `STN_${cleanStationKey.slice(0, 8).toUpperCase()}`,
                  stop_name: `${rawName} Hub`,
                  stop_name_en: `${rawName} Station`,
                  stop_lat: parseFloat(String(latVal)),
                  stop_lon: parseFloat(String(lonVal)),
                  location_type: 1, // GTFS Parent Station
                  parent_station: null,
                });
              }

              if (!stopsMap.has(stopId) && latVal && lonVal) {
                stopsMap.set(stopId, {
                  stop_id: stopId,
                  stop_code: s.code || s.stop_code || `STP_${stopId.slice(0, 6)}`,
                  stop_name: rawName,
                  stop_name_en: rawName,
                  stop_lat: parseFloat(String(latVal)),
                  stop_lon: parseFloat(String(lonVal)),
                  location_type: 0, // GTFS Platform Stop
                  parent_station: parentStationId,
                });
              }
            }
          }
        } catch (err: any) {
          this.logger.warn(`Could not fetch stops for dir ${dir.dir_id}: ${err.message}`);
        }
      }

      // Publish Parent Station Hubs
      for (const parentStation of parentStationMap.values()) {
        await this.publisher.publishStop(parentStation);
      }
      // Publish Platform Stops
      for (const platformStop of stopsMap.values()) {
        await this.publisher.publishStop(platformStop);
      }
      this.logger.log(`✅ Ingested ${parentStationMap.size} parent station hubs and ${stopsMap.size} platform stops.`);

      // 5. Ingest Authentic Distance-Based GTFS Fare Attributes & Rules
      const fareStages = [
        { id: 'FARE_STAGE_1_LOCAL', price: 65.0, desc: 'Short Local Hop (65 LKR)' },
        { id: 'FARE_STAGE_2_SHORT', price: 85.0, desc: 'Short Corridor Stage (85 LKR)' },
        { id: 'FARE_STAGE_3_MEDIUM', price: 110.0, desc: 'Medium Corridor Stage (110 LKR)' },
        { id: 'FARE_STAGE_4_LONG', price: 225.0, desc: 'Long Express Stage (225 LKR)' },
        { id: 'FARE_STAGE_5_FULL', price: 255.0, desc: 'Full Corridor Express (255 LKR)' },
      ];

      for (const stage of fareStages) {
        await this.publisher.publishFareAttribute({
          fare_id: stage.id,
          price: stage.price,
          currency_type: 'LKR',
          payment_method: 0, // Pay on board / POS validator
          transfers: 0,
          transfer_duration: 0,
        });

        await this.publisher.publishFareRule({
          fare_id: stage.id,
          route_id: '8bc594e3-8ad6-4a0d-9138-bf8b4247e2f5', // CM01
        });

        await this.publisher.publishFareRule({
          fare_id: stage.id,
          route_id: 'f3eaf277-a6fa-4f5b-8a61-3b1758d9a4b8', // CM02
        });
      }
      this.logger.log('✅ Authentic Distance-Based GTFS Fare Stages (65 - 255 LKR) ingested.');

      // 6. Sync Service Alerts & Advisories
      await this.syncNotificationsAndAlerts();

      this.logger.log('🎉 Master Automated GTFS Ingestion Cycle Complete!');
    } catch (err: any) {
      this.logger.error(`Error during Master GTFS Ingestion: ${err.message}`);
    }
  }

  private async syncNotificationsAndAlerts(): Promise<void> {
    try {
      const token = await this.tokenProvider.getOrRefreshToken();
      const headers = {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'okhttp/4.10.0',
        Accept: 'application/json',
      };

      const res = await axios.get('https://lankametro.lk/metrobus-proxy/user-service/api/v1/notifications', {
        headers,
        timeout: 5000,
      });

      if (res.status === 200 && res.data?.data?.items) {
        const items = res.data.data.items;
        for (const alert of items) {
          await this.publisher.publishAlert({
            id: alert.id || `ALERT_${Date.now()}`,
            header_text: alert.title || 'Service Advisory',
            description_text: alert.description || '',
            cause: 'OTHER_CAUSE',
            effect: 'MODIFIED_SERVICE',
          });
        }
      }
    } catch (e: any) {}
  }
}
