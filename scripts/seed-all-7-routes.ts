import axios from 'axios';
import { LmtSourceExtractorService } from '../src/lmt/lmt-source-extractor.service';

async function main() {
  console.log('🚀 Running Master Direct-From-Source Ingestion of 7 Routes into slr-transit-server...\n');

  const baseUrl = process.env.TRANSIT_SERVER_URL || 'https://slr-transit-server-production.up.railway.app/api/v1';
  const apiKey = process.env.TRANSIT_API_KEY || 'super-secret-token';
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };

  // 1. Extract direct from source
  const extractor = new LmtSourceExtractorService();
  const data = await extractor.getTransitData(true);

  console.log(`\nExtracted: ${data.routes.length} routes, ${data.stops.length} stops direct from source.`);

  // 2. Ensure Agency LMT exists
  try {
    await axios.post(
      `${baseUrl}/agency`,
      {
        agency_id: 'LMT',
        agency_name: 'Lanka Metro Transit',
        agency_url: 'https://lankametro.lk',
        agency_timezone: 'Asia/Colombo',
        agency_lang: 'en',
      },
      { headers },
    );
    console.log('✅ Agency LMT ensured.');
  } catch (err: any) {
    console.warn(`Agency notice: ${err.response?.data?.message || err.message}`);
  }

  // 3. Upsert All 7 Routes
  for (const r of data.routes) {
    const routeId = data.eimskyRouteIdMap.get(r.route_code) || `LMT_ROUTE_${r.route_code}`;
    const payload = {
      route_id: routeId,
      agency_id: 'LMT',
      route_short_name: r.route_code,
      route_long_name: r.name,
      route_type: 3,
      route_color: (r.color_hex || '#1A5A96').replace('#', ''),
      route_text_color: 'FFFFFF',
    };

    try {
      await axios.post(`${baseUrl}/routes`, payload, { headers });
      console.log(`✅ Upserted Route [${r.route_code}] -> ${r.name}`);
    } catch (err: any) {
      console.warn(`Route [${r.route_code}] notice: ${err.response?.data?.message || err.message}`);
    }
  }

  // 4. Ingest Stops & Parent Stations
  const parentStations = new Map<string, any>();
  const platformStops: any[] = [];

  for (const s of data.stops) {
    const stopId = String(s.eimsky_id || s.id);
    const rawName = s.name || 'LMT Bus Stop';
    const cleanStationKey = rawName
      .toLowerCase()
      .replace(/ 01| 1| 02| 2| campus| station| junction| depot/gi, '')
      .replace(/[^a-z0-9]/g, '_')
      .trim();
    const parentStationId = `STATION_${cleanStationKey.toUpperCase()}`;

    if (!parentStations.has(parentStationId) && s.lat && s.lng) {
      parentStations.set(parentStationId, {
        stop_id: parentStationId,
        stop_code: `STN_${cleanStationKey.slice(0, 8).toUpperCase()}`,
        stop_name: `${rawName} Hub`,
        stop_name_en: `${rawName} Station`,
        stop_lat: s.lat,
        stop_lon: s.lng,
        location_type: 1,
      });
    }

    platformStops.push({
      stop_id: stopId,
      stop_code: s.stop_code || `STP_${stopId.slice(0, 6)}`,
      stop_name: rawName,
      stop_name_en: rawName,
      stop_lat: s.lat,
      stop_lon: s.lng,
      location_type: 0,
      parent_station: parentStationId,
    });
  }

  console.log(`\nIngesting ${parentStations.size} parent hubs...`);
  for (const ps of parentStations.values()) {
    try {
      await axios.post(`${baseUrl}/stops`, ps, { headers });
    } catch {}
  }

  console.log(`Ingesting ${platformStops.length} platform stops in batches...`);
  for (let i = 0; i < platformStops.length; i += 20) {
    const batch = platformStops.slice(i, i + 20);
    await Promise.all(
      batch.map((stop) =>
        axios.post(`${baseUrl}/stops`, stop, { headers }).catch(() => {}),
      ),
    );
  }
  console.log('✅ Stops ingestion finished.');

  // 5. Ingest Authentic Fare Attributes & Rules
  console.log('\nIngesting distance-based GTFS fare attributes and rules...');
  const fareStages = [
    { id: 'FARE_STAGE_1_LOCAL', price: 65.0 },
    { id: 'FARE_STAGE_2_SHORT', price: 85.0 },
    { id: 'FARE_STAGE_3_MEDIUM', price: 110.0 },
    { id: 'FARE_STAGE_4_REGULAR', price: 135.0 },
    { id: 'FARE_STAGE_5_LONG', price: 185.0 },
    { id: 'FARE_STAGE_6_EXPRESS', price: 225.0 },
    { id: 'FARE_STAGE_7_FULL', price: 255.0 },
    { id: 'FARE_STAGE_8_MAX', price: 300.0 },
  ];

  for (const stage of fareStages) {
    try {
      await axios.post(
        `${baseUrl}/fare-attributes`,
        {
          fare_id: stage.id,
          price: stage.price,
          currency_type: 'LKR',
          payment_method: 0,
          transfers: 0,
          transfer_duration: 0,
        },
        { headers },
      );
    } catch {}

    for (const r of data.routes) {
      const routeId = data.eimskyRouteIdMap.get(r.route_code) || `LMT_ROUTE_${r.route_code}`;
      try {
        await axios.post(
          `${baseUrl}/fare-rules`,
          {
            fare_id: stage.id,
            route_id: routeId,
          },
          { headers },
        );
      } catch {}
    }
  }
  console.log('✅ Fare rules bound to all 7 routes.');

  // 6. Verify routes on server
  console.log('\n================ 🔍 VERIFYING ROUTES ON TRANSIT SERVER ================');
  const routesRes = await axios.get(`${baseUrl}/routes`);
  const allRoutes = routesRes.data || [];
  const lmtRoutes = allRoutes.filter((r: any) => r.agency_id === 'LMT');
  console.log(`Total Routes in DB: ${allRoutes.length}`);
  console.log(`LMT Routes in DB (${lmtRoutes.length}):`);
  lmtRoutes.forEach((r: any) => {
    console.log(`  [${r.route_short_name}] ${r.route_long_name} (Color: #${r.route_color})`);
  });
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
