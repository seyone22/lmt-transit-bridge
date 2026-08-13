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
    { id: "8bc594e3-8ad6-4a0d-9138-bf8b4247e2f5", dir: "fe423b83-34e7-4bd5-816b-97968dcd2b1f" },
    { id: "f3eaf277-a6fa-4f5b-8a61-3b1758d9a4b8", dir: "47831874-290c-4beb-959a-3e004f8e0e00" }
  ];

  for (const r of routes) {
    const url = `https://lankametro.lk/metrobus-proxy/fare-service/api/v1/routes/${r.id}/stops?direction_id=${r.dir}`;
    try {
      const res = await axios.get(url, { headers });
      const stops = res.data?.data?.stops || res.data?.stops || res.data?.data || [];
      const first = stops[0]?.stop_name_en || 'Start';
      const last = stops[stops.length - 1]?.stop_name_en || 'End';
      console.log(`\nRoute UUID: ${r.id}`);
      console.log(`  Stops Count: ${stops.length}`);
      console.log(`  Origin:      ${first}`);
      console.log(`  Destination: ${last}`);
      console.log(`  Stop Codes:  ${stops.slice(0, 5).map(s => s.stop_code).join(', ')}`);
    } catch (e) {
      console.error(`Error for ${r.id}:`, e.message);
    }
  }
})();
