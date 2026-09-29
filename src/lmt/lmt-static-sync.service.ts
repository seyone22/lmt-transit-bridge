import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import axios from 'axios';
import { GtfsRealtimePublisherService } from '../publisher/gtfs-realtime-publisher.service';
import { TokenProviderService } from '../auth/token-provider.service';
import { LmtSourceExtractorService } from './lmt-source-extractor.service';

@Injectable()
export class LmtStaticSyncService implements OnModuleInit {
  private readonly logger = new Logger(LmtStaticSyncService.name);

  constructor(
    private readonly publisher: GtfsRealtimePublisherService,
    private readonly tokenProvider: TokenProviderService,
    private readonly sourceExtractor: LmtSourceExtractorService,
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

      // 2. Fetch Direct-From-Source Transit Data (All 7 Routes, 220 Stops, 2009 Fares)
      const transitData = await this.sourceExtractor.getTransitData();

      // 3. Ingest Route Shapes - Skip if already ingested
      const baseUrl = process.env.TRANSIT_SERVER_URL || 'http://slr-transit-server.railway.internal:8080/api/v1';
      let shapesAlreadyIngested = false;
      try {
        const existingShapes = await axios.get(`${baseUrl}/shapes/SHAPE_CM01`, { timeout: 3000 });
        if (existingShapes.status === 200 && Array.isArray(existingShapes.data) && existingShapes.data.length > 0) {
          shapesAlreadyIngested = true;
          this.logger.log(`✅ Route shapes already present in DB (${existingShapes.data.length} waypoints). Skipping re-ingestion.`);
        }
      } catch (e) {}

      if (!shapesAlreadyIngested) {
        const shapeConfigs = [
          { url: 'https://lankametro.lk/gcs-proxy/artwork_storage_dev/v7.2-Forward-M-K.geojson', shapeIds: ['SHAPE_CM01', 'SHAPE_CM03'] },
          { url: 'https://lankametro.lk/gcs-proxy/artwork_storage_dev/v7.2-Return-K-M.geojson', shapeIds: ['SHAPE_CM01_RET', 'SHAPE_CM03_RET'] },
          { url: 'https://lankametro.lk/gcs-proxy/artwork_storage_dev/metro/v7.2%20Forward-M-C.geojson', shapeIds: ['SHAPE_CM02', 'SHAPE_CM08'] },
          { url: 'https://lankametro.lk/gcs-proxy/artwork_storage_dev/metro/v7.2-Return-C-M.geojson', shapeIds: ['SHAPE_CM02_RET', 'SHAPE_CM08_RET'] },
        ];

        for (const cfg of shapeConfigs) {
          try {
            const geoRes = await axios.get(cfg.url, { timeout: 10000 });
            if (geoRes.status === 200 && geoRes.data) {
              const lineFeature = geoRes.data.features?.find(
                (f: any) => f.geometry?.type === 'LineString' || f.geometry?.type === 'MultiLineString',
              );
              if (lineFeature?.geometry?.coordinates) {
                const coords: number[][] = lineFeature.geometry.coordinates;
                for (let i = 0; i < coords.length; i += 50) {
                  const chunk = coords.slice(i, i + 50);
                  for (const sId of cfg.shapeIds) {
                    await Promise.all(
                      chunk.map((c, idx) =>
                        this.publisher.publishShape({
                          shape_id: sId,
                          shape_pt_lat: c[1],
                          shape_pt_lon: c[0],
                          shape_pt_sequence: i + idx + 1,
                        }),
                      ),
                    );
                  }
                }
                this.logger.log(`✅ Shape [${cfg.shapeIds.join(', ')}] ingested (${coords.length} waypoints).`);
              }
            }
          } catch (shapeErr: any) {
            this.logger.warn(`Could not ingest shape from ${cfg.url}: ${shapeErr.message}`);
          }
        }
      }

      // 4. Ingest All 7 Master Routes Direct From Source
      for (const r of transitData.routes) {
        const routeId = transitData.eimskyRouteIdMap.get(r.route_code) || `LMT_ROUTE_${r.route_code}`;
        await this.publisher.publishRoute({
          route_id: routeId,
          agency_id: 'LMT',
          route_short_name: r.route_code,
          route_long_name: r.name,
          route_type: 3,
          route_color: (r.color_hex || '#1A5A96').replace('#', ''),
          route_text_color: 'FFFFFF',
        });
      }
      this.logger.log(`✅ Master bus routes (${transitData.routes.length}) synced direct from source.`);

      // 5. Ingest All 220 Platform Stops & Parent Station Hubs Direct From Source
      const parentStationMap = new Map<string, any>();
      const stopsMap = new Map<string, any>();

      for (const s of transitData.stops) {
        const stopId = String(s.eimsky_id || s.id);
        const latVal = s.lat;
        const lonVal = s.lng;
        const rawName = s.name || 'LMT Bus Stop';

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
            stop_code: s.stop_code || `STP_${stopId.slice(0, 6)}`,
            stop_name: rawName,
            stop_name_en: rawName,
            stop_lat: parseFloat(String(latVal)),
            stop_lon: parseFloat(String(lonVal)),
            location_type: 0, // GTFS Platform Stop
            parent_station: parentStationId,
          });
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
      this.logger.log(`✅ Ingested ${parentStationMap.size} parent station hubs and ${stopsMap.size} platform stops direct from source.`);

      // 6. Ingest Authentic Distance-Based GTFS Fare Stages & Rules Across All Routes
      const fareStages = [
        { id: 'FARE_STAGE_1_LOCAL', price: 65.0, desc: 'Short Local Hop (65 LKR)' },
        { id: 'FARE_STAGE_2_SHORT', price: 85.0, desc: 'Short Corridor Stage (85 LKR)' },
        { id: 'FARE_STAGE_3_MEDIUM', price: 110.0, desc: 'Medium Corridor Stage (110 LKR)' },
        { id: 'FARE_STAGE_4_REGULAR', price: 135.0, desc: 'Suburban Regular Stage (135 LKR)' },
        { id: 'FARE_STAGE_5_LONG', price: 185.0, desc: 'Long Regional Stage (185 LKR)' },
        { id: 'FARE_STAGE_6_EXPRESS', price: 225.0, desc: 'Long Express Stage (225 LKR)' },
        { id: 'FARE_STAGE_7_FULL', price: 255.0, desc: 'Full Corridor Express (255 LKR)' },
        { id: 'FARE_STAGE_8_MAX', price: 300.0, desc: 'Outer Terminal Express (300 LKR)' },
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

        // Bind fare rules across all 7 active routes
        for (const r of transitData.routes) {
          const routeId = transitData.eimskyRouteIdMap.get(r.route_code) || `LMT_ROUTE_${r.route_code}`;
          await this.publisher.publishFareRule({
            fare_id: stage.id,
            route_id: routeId,
          });
        }
      }
      this.logger.log(`✅ Authentic Distance-Based GTFS Fare Stages (65 - 300 LKR) ingested across all 7 routes.`);

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
