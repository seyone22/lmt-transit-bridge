const { chromium } = require('playwright');

(async () => {
  console.log("Fetching live SmartMetro bus positions...");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  let liveBuses = [];

  page.on('websocket', ws => {
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
    await page.waitForTimeout(6000); // Wait for GPS update frame
  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    await browser.close();
  }

  console.log("\n================ LIVE ACTIVE BUSES ================");
  console.log(`Total Active Buses Found: ${liveBuses.length}\n`);

  liveBuses.forEach((bus, index) => {
    console.log(`Bus #${index + 1}:`);
    console.log(`  Registration: ${bus.registration_number}`);
    console.log(`  Bus ID:       ${bus.bus_id}`);
    console.log(`  Route ID:     ${bus.route_id}`);
    console.log(`  Latitude:     ${bus.lat}`);
    console.log(`  Longitude:    ${bus.lng}`);
    console.log(`  Capacity:     ${bus.current_capacity}/${bus.total_capacity}`);
    console.log(`  Timestamp:    ${new Date(bus.timestamp).toISOString()}\n`);
  });
})();
