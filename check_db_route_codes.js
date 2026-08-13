const axios = require('axios');

async function checkDbRoutes() {
  try {
    const res = await axios.get('https://slr-transit-server-production.up.railway.app/api/v1/routes');
    const routes = res.data || [];
    console.log(`Total routes in DB: ${routes.length}\n`);

    routes.forEach(r => {
      console.log(`Route ID: ${r.route_id}`);
      console.log(`  Short Name: ${r.route_short_name}`);
      console.log(`  Long Name:  ${r.route_long_name}`);
      console.log(`  Agency ID:  ${r.agency_id}\n`);
    });
  } catch (e) {
    console.error("Error:", e.message);
  }
}

checkDbRoutes();
