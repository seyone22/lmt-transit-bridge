const { chromium } = require('playwright');

(async () => {
  console.log("Launching headless browser to capture SmartMetro network traffic...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('request', req => {
    const url = req.url();
    if (url.includes('ws') || url.includes('eimsky') || url.includes('token') || url.includes('metrobus') || url.includes('api')) {
      console.log(`[REQ] ${req.method()} ${url}`);
      const headers = req.headers();
      if (headers['authorization'] || headers['x-api-key'] || headers['token']) {
        console.log(`  Headers:`, headers);
      }
    }
  });

  page.on('response', async resp => {
    const url = resp.url();
    if (url.includes('eimsky') || url.includes('token') || url.includes('metrobus') || url.includes('api')) {
      console.log(`[RESP ${resp.status()}] ${url}`);
      try {
        const text = await resp.text();
        if (text.includes('token') || text.includes('eyJ') || text.includes('bearer')) {
          console.log(`  Body text snippet: ${text.slice(0, 300)}`);
        }
      } catch (e) {}
    }
  });

  page.on('websocket', ws => {
    console.log(`[WEBSOCKET OPENED] ${ws.url()}`);
    ws.on('framesent', frame => console.log(`  [WS SENT] ${frame.payload}`));
    ws.on('framereceived', frame => console.log(`  [WS RECV] ${frame.payload}`));
  });

  try {
    await page.goto('https://lankametro.lk/en/smartmetro', { waitUntil: 'networkidle', timeout: 30000 });
    console.log("Page loaded. Waiting 15s for WebSocket & API updates...");
    await page.waitForTimeout(15000);
  } catch (err) {
    console.error("Error during page load:", err.message);
  } finally {
    await browser.close();
  }
})();
