const axios = require('axios');

async function fetchLivePositions() {
  const baseUrl = 'https://slr-transit-server-production.up.railway.app/api/v1';

  try {
    const res = await axios.get(`${baseUrl}/realtime/vehicle-positions/list`);
    const buses = res.data;

    // Filter buses updated within the last 5 minutes
    const nowSec = Math.floor(Date.now() / 1000);
    const activeBuses = buses.filter(b => {
      const ts = new Date(b.updated_at).getTime() / 1000;
      return (nowSec - ts) < 300;
    });

    console.log(`\nActive Live SmartMetro Buses Currently Ingesting (${activeBuses.length}):`);
    activeBuses.forEach((b, i) => {
      console.log(`Bus #${i+1}:`);
      console.log(`  Vehicle ID:    ${b.vehicle_id}`);
      console.log(`  Trip ID:       ${b.trip_id}`);
      console.log(`  Latitude:      ${b.latitude}`);
      console.log(`  Longitude:     ${b.longitude}`);
      console.log(`  Speed:         ${b.speed || 0} km/h`);
      console.log(`  Bearing:       ${b.bearing || 0}°`);
      console.log(`  Last Ingested: ${b.updated_at}`);
    });
  } catch (err) {
    console.error("Error:", err.message);
  }
}

fetchLivePositions();
