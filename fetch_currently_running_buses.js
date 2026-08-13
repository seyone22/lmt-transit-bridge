const axios = require('axios');

async function fetchLiveRunningBuses() {
  const baseUrl = 'https://slr-transit-server-production.up.railway.app/api/v1';

  try {
    const res = await axios.get(`${baseUrl}/realtime/vehicle-positions/list`);
    const buses = res.data || [];

    const nowSec = Math.floor(Date.now() / 1000);
    // Filter buses active within last 10 minutes
    const runningBuses = buses.filter(b => {
      const tsSec = Math.floor(new Date(b.updated_at || b.timestamp).getTime() / 1000);
      return (nowSec - tsSec) < 600;
    });

    console.log(`\n================ 🚌 LIVE RUNNING BUSES RIGHT NOW (${runningBuses.length}) ================`);
    runningBuses.forEach((b, i) => {
      console.log(`Bus #${i+1}:`);
      console.log(`  Vehicle ID / Plate: ${b.vehicle_id || b.license_plate || 'Assigned Bus'}`);
      console.log(`  Trip ID:            ${b.trip_id}`);
      console.log(`  Current Position:   (${b.latitude.toFixed(4)}, ${b.longitude.toFixed(4)})`);
      console.log(`  Speed:              ${b.speed || 0} km/h`);
      console.log(`  Heading/Bearing:    ${b.bearing || 0}°`);
      console.log(`  Last Update:        ${new Date(b.updated_at || b.timestamp).toLocaleTimeString()} (${new Date(b.updated_at || b.timestamp).toISOString()})\n`);
    });
  } catch (err) {
    console.error("Error fetching live running buses:", err.message);
  }
}

fetchLiveRunningBuses();
