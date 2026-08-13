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

  const urls = [
    "https://lankametro.lk/metrobus-proxy/fare-service/api/v1/routes/get-all-active-routes-by-search?search=",
    "https://lankametro.lk/metrobus-proxy/fare-service/api/v1/routes/8bc594e3-8ad6-4a0d-9138-bf8b4247e2f5/stops?direction_id=fe423b83-34e7-4bd5-816b-97968dcd2b1f",
    "https://lankametro.lk/metrobus-proxy/fare-service/api/v1/routes/f3eaf277-a6fa-4f5b-8a61-3b1758d9a4b8/stops?direction_id=47831874-290c-4beb-959a-3e004f8e0e00"
  ];

  for (const url of urls) {
    try {
      const res = await axios.get(url, { headers });
      const str = JSON.stringify(res.data);
      console.log(`\nURL: ${url}`);
      console.log(`  Raw Text Contains 'CM01': ${str.includes('CM01') || str.includes('CM-01')}`);
      console.log(`  Raw Text Contains 'CM02': ${str.includes('CM02') || str.includes('CM-02')}`);
      console.log(`  Raw Text Contains 'Corridor': ${str.includes('Corridor')}`);
      console.log(`  Raw Text Sample: ${str.slice(0, 300)}`);
    } catch (e) {
      console.error(`Error for ${url}:`, e.message);
    }
  }
})();
