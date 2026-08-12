const { chromium } = require('playwright');

(async () => {
  console.log("Sniffing ALL HTTP requests on lankametro.lk...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('request', req => {
    console.log(`[REQ] ${req.method()} ${req.url()}`);
    if (req.method() === 'POST') {
      console.log(`  POST Payload: ${req.postData()}`);
    }
  });

  page.on('response', async resp => {
    const url = resp.url();
    if (url.includes('api') || url.includes('auth') || url.includes('token') || url.includes('user')) {
      console.log(`[RESP ${resp.status()}] ${url}`);
      try {
        const text = await resp.text();
        if (text.includes('token') || text.includes('eyJ')) {
          console.log(`  TOKEN IN RESPONSE: ${text.slice(0, 400)}`);
        }
      } catch (e) {}
    }
  });

  try {
    await page.goto('https://lankametro.lk/en/smartmetro', { waitUntil: 'networkidle' });
  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    await browser.close();
  }
})();
