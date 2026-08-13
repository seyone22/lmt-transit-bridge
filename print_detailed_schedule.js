const { chromium } = require('playwright');
const axios = require('axios');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  let token = null;

  page.on('websocket', ws => {
    const match = ws.url().match(/token=(eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*)/);
    if (match && match[1]) token = match[1];
  });

  try {
    await page.goto('https://lankametro.lk/en/smartmetro', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
  } finally {
    await browser.close();
  }

  const headers = {
    'User-Agent': 'Mozilla/5.0',
    'Referer': 'https://lankametro.lk/en/smartmetro',
    'Authorization': `Bearer ${token}`
  };

  const routes = [
    { id: "8bc594e3-8ad6-4a0d-9138-bf8b4247e2f5", name: "Maharagama - Kadawatha Corridor" },
    { id: "f3eaf277-a6fa-4f5b-8a61-3b1758d9a4b8", name: "Fort - Battaramulla Express" }
  ];

  for (const dateStr of ["2026-08-12", "2026-08-13"]) {
    console.log(`\n=================== 📅 SCHEDULE FOR ${dateStr} ===================`);
    for (const r of routes) {
      const url = `https://lankametro.lk/metrobus-proxy/ticketing-service/api/v1/bus-schedule-assignments/daily-schedule?date=${dateStr}&route_id=${r.id}`;
      try {
        const res = await axios.get(url, { headers });
        const trips = res.data?.data || res.data || [];
        console.log(`\nRoute: ${r.name} (${trips.length} Trips):`);
        trips.forEach((t, i) => {
          console.log(`  Trip #${i+1}: Bus [${t.bus_registration_number || t.bus_reg_number || t.bus_id || 'Assigned Bus'}]`);
          console.log(`    Departure: ${t.start_time || t.departure_time || t.assigned_start_time || t.created_at}`);
          console.log(`    Arrival:   ${t.end_time || t.arrival_time || t.assigned_end_time || t.updated_at}`);
          if (t.driver_name) console.log(`    Driver:    ${t.driver_name}`);
        });
      } catch (e) {
        console.error("Fetch error:", e.message);
      }
    }
  }
})();
