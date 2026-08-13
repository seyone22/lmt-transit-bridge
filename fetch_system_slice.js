const axios = require('axios');

async function fetchSlice() {
  const baseUrl = 'https://slr-transit-server-production.up.railway.app/api/v1';

  console.log("================ 1. FETCHING ROUTES ================");
  try {
    const res = await axios.get(`${baseUrl}/routes`);
    const routes = Array.isArray(res.data) ? res.data : (res.data.data || []);
    console.log(`Total Routes: ${routes.length}`);
    routes.slice(0, 5).forEach((r, i) => {
      console.log(`Route #${i+1}: [${r.route_short_name || r.route_id}] ${r.route_long_name} (Color: #${r.route_color || 'N/A'})`);
    });
  } catch (err) {
    console.error("Routes error:", err.message);
  }

  console.log("\n================ 2. FETCHING STOPS ================");
  try {
    const res = await axios.get(`${baseUrl}/stops`);
    const stops = Array.isArray(res.data) ? res.data : (res.data.data || []);
    console.log(`Total Stops: ${stops.length}`);
    stops.slice(0, 5).forEach((s, i) => {
      console.log(`Stop #${i+1}: [${s.stop_code || s.stop_id}] ${s.stop_name} @ (${s.stop_lat}, ${s.stop_lon})`);
    });
  } catch (err) {
    console.error("Stops error:", err.message);
  }

  console.log("\n================ 3. FETCHING LIVE BUSES ================");
  try {
    const res = await axios.get(`${baseUrl}/realtime/vehicle-positions/list`);
    const buses = Array.isArray(res.data) ? res.data : (res.data.data || []);
    console.log(`Total Active Buses Streaming: ${buses.length}`);
    buses.slice(0, 8).forEach((b, i) => {
      console.log(`Bus #${i+1}: ${b.vehicle_id || b.license_plate} | Trip: ${b.trip_id} | Lat/Lng: (${b.latitude.toFixed(4)}, ${b.longitude.toFixed(4)}) | Last Update: ${b.updated_at || b.timestamp}`);
    });
  } catch (err) {
    console.error("Buses error:", err.message);
  }
}

fetchSlice();
