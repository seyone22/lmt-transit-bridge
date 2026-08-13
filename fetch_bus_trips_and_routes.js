const axios = require('axios');

async function fetchBusTripsAndRoutes() {
  const baseUrl = 'https://slr-transit-server-production.up.railway.app/api/v1';

  console.log("================ 🚌 BUS ROUTES IN SYSTEM ================");
  try {
    const resRoutes = await axios.get(`${baseUrl}/routes`);
    const allRoutes = resRoutes.data || [];
    // Filter bus routes (route_type = 3 or bus route names)
    const busRoutes = allRoutes.filter(r => r.route_type === 3 || r.route_type === 700 || !['Main', 'Coast', 'Northern', 'Kelani', 'Batticaloa'].some(k => (r.route_short_name||'').includes(k)));
    
    console.log(`Total Bus Routes: ${busRoutes.length}`);
    busRoutes.forEach((r, i) => {
      console.log(`Route #${i+1}:`);
      console.log(`  Route ID:         ${r.route_id}`);
      console.log(`  Route Short Name: ${r.route_short_name || 'N/A'}`);
      console.log(`  Route Long Name:  ${r.route_long_name}`);
      console.log(`  Route Type:       Bus (Type ${r.route_type})`);
      console.log(`  Agency ID:        ${r.agency_id}\n`);
    });
  } catch (err) {
    console.error("Error fetching routes:", err.message);
  }

  console.log("================ 📋 BUS TRIPS IN SYSTEM ================");
  try {
    const resPositions = await axios.get(`${baseUrl}/realtime/vehicle-positions/list`);
    const positions = resPositions.data || [];

    // Group trips by route ID or trip ID
    const tripMap = new Map();
    positions.forEach(p => {
      if (!tripMap.has(p.trip_id)) {
        tripMap.set(p.trip_id, {
          trip_id: p.trip_id,
          vehicle_id: p.vehicle_id || p.license_plate || 'Assigned Bus',
          latitude: p.latitude,
          longitude: p.longitude,
          speed: p.speed,
          bearing: p.bearing,
          updated_at: p.updated_at || p.timestamp
        });
      }
    });

    console.log(`Total Bus Trips Active in Realtime Feed: ${tripMap.size}\n`);
    let idx = 1;
    for (const [tripId, trip] of tripMap.entries()) {
      console.log(`Trip #${idx++}:`);
      console.log(`  Trip ID:    ${trip.trip_id}`);
      console.log(`  Vehicle ID: ${trip.vehicle_id}`);
      console.log(`  Lat/Lng:    (${trip.latitude.toFixed(4)}, ${trip.longitude.toFixed(4)})`);
      console.log(`  Speed:      ${trip.speed || 0} km/h`);
      console.log(`  Last Update:${trip.updated_at}\n`);
    }
  } catch (err) {
    console.error("Error fetching trips:", err.message);
  }
}

fetchBusTripsAndRoutes();
