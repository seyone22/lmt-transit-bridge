const axios = require('axios');

async function verifyAgenciesAndRoutes() {
  const baseUrl = 'https://slr-transit-server-production.up.railway.app/api/v1';

  console.log("================ 🏢 AGENCIES IN DATABASE ================");
  try {
    const agencyRes = await axios.get(`${baseUrl}/agency`);
    console.log("Agencies:", agencyRes.data);
  } catch (e) {
    console.error("Agency error:", e.message);
  }

  console.log("\n================ 🗺️ ROUTES IN DATABASE ================");
  try {
    const routeRes = await axios.get(`${baseUrl}/routes`);
    const routes = routeRes.data || [];
    console.log(`Total Routes in Production Database: ${routes.length}\n`);

    const slrRoutes = routes.filter(r => r.agency_id === 'SLR' || r.route_type === 2);
    const lmtRoutes = routes.filter(r => r.agency_id === 'LMT' || r.route_type === 3);

    console.log(`🚆 Sri Lanka Railways (SLR) Routes (${slrRoutes.length}):`);
    slrRoutes.forEach(r => console.log(`  - [${r.route_short_name || r.route_id}] ${r.route_long_name}`));

    console.log(`\n🚌 Lanka Metro Transit (LMT) Routes (${lmtRoutes.length}):`);
    lmtRoutes.forEach(r => console.log(`  - [${r.route_short_name}] (${r.route_id.slice(0, 8)}) ${r.route_long_name}`));
  } catch (e) {
    console.error("Routes error:", e.message);
  }

  console.log("\n================ 📡 ACTIVE REAL-TIME STREAMING ================");
  try {
    const posRes = await axios.get(`${baseUrl}/realtime/vehicle-positions/list`);
    const buses = posRes.data || [];
    console.log(`Total Live Vehicles Streaming In Real-Time: ${buses.length}`);
  } catch (e) {
    console.error("Realtime error:", e.message);
  }
}

verifyAgenciesAndRoutes();
