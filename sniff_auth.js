const { chromium } = require('playwright');

(async () => {
  console.log("Sniffing exact LMT Go headers and token...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('request', req => {
    const url = req.url();
    if (url.includes('metrobus-proxy') || url.includes('api')) {
      console.log(`\n[REQ] ${req.method()} ${url}`);
      console.log('Headers:', JSON.stringify(req.headers(), null, 2));
    }
  });

  try {
    await page.goto('https://lankametro.lk/en/smartmetro', { waitUntil: 'networkidle' });
    await page.waitForTimeout(5000);
  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    await browser.close();
  }
})();
