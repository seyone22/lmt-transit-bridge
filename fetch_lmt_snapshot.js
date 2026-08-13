const { chromium } = require('playwright');
const axios = require('axios');

(async () => {
  console.log("Fetching snapshot of Lanka Metro Transit (LMT) Bus Network...\n");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  let token = null;
  let liveBuses = [];

  page.on('websocket', ws => {
    const url = ws.url();
    const match = url.match(/token=(eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*)/);
    if (match && match[1]) token = match[1];

    ws.on('framereceived', frame => {
      try {
        const data = JSON.parse(frame.payload);
        if (data.type === 'gps_update' && data.payload) {
          liveBuses = data.payload;
        }
      } catch (e) {}
    });
  });

  try {
    await page.goto('https://lankametro.lk/en/smartmetro', { waitUntil: 'networkidle' });
    await page.waitForTimeout(6000);
  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    await browser.close();
  }

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer': 'https://lankametro.lk/en/smartmetro',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
  };

  console.log("================ 🚌 1. LMT BUS ROUTES ================");
  let sampleRouteId = null;
  try {
    const routesRes = await axios.get('https://lankametro.lk/metrobus-proxy/fare-service/api/v1/routes/get-all-active-routes-by-search?search=', { headers });
    const routes = routesRes.data?.data || routesRes.data || [];
    console.log(`Total Active LMT Bus Routes: ${routes.length}\n`);

    routes.slice(0, 5).forEach((r, i) => {
      console.log(`LMT Route #${i+1}:`);
      console.log(`  Route ID:   ${r.id || r.route_id}`);
      console.log(`  Route Name: ${r.route_name || r.name || r.title || 'LMT Metro Bus Corridor'}`);
      console.log(`  Code/Number:${r.route_number || r.code || 'N/A'}`);
      console.log(`  Operator:   Lanka Metro Transit (SmartMetro)\n`);
    });

    if (routes[0]) sampleRouteId = routes[0].id || routes[0].route_id;
  } catch (e) {
    console.log("Failed to fetch LMT routes list:", e.message);
  }

  if (sampleRouteId) {
    console.log(`================ 🚏 2. LMT STOPS (Route ${sampleRouteId.slice(0, 8)}) ================`);
    try {
      const stopsRes = await axios.get(`https://lankametro.lk/metrobus-proxy/fare-service/api/v1/routes/${sampleRouteId}/stops`, { headers });
      const stops = stopsRes.data?.data || stopsRes.data || [];
      console.log(`Total Stops along Route: ${stops.length}\n`);

      stops.slice(0, 6).forEach((s, i) => {
        console.log(`Stop #${i+1}: [Seq ${s.sequence || i+1}] ${s.stop_name || s.name || 'LMT Bus Station'} @ (${s.lat || s.latitude}, ${s.lng || s.longitude})`);
      });
    } catch (e) {
      console.log("Stops fetch error:", e.message);
    }
  }

  console.log("\n================ 📡 3. CURRENT ACTIVE LMT BUSES STREAMING ================");
  console.log(`Total Live LMT Buses Currently Transmitting GPS: ${liveBuses.length}\n`);

  liveBuses.forEach((b, i) => {
    console.log(`LMT Bus #${i+1}:`);
    console.log(`  Bus Registration: ${b.registration_number}`);
    console.log(`  Bus UUID:         ${b.bus_id}`);
    console.log(`  Route ID:         ${b.route_id}`);
    console.log(`  Direction ID:     ${b.direction_id}`);
    console.log(`  Current Location: (${b.lat}, ${b.lng})`);
    console.log(`  Bus Capacity:     ${b.current_capacity}/${b.total_capacity}`);
    console.log(`  GPS Timestamp:    ${new Date(b.timestamp).toISOString()}\n`);
  });
})();
