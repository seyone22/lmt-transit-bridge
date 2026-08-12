const WebSocket = require('ws');

const token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzbWFydG1ldHJvLWxvY2F0aW9uLXNlcnZpY2UiLCJpYXQiOjE3NzA4ODAxMDB9.x";

async function test(url, extraHeaders = {}) {
  console.log(`\nTesting: ${url}`);
  return new Promise((resolve) => {
    const ws = new WebSocket(url, {
      headers: {
        'Origin': 'https://lankametro.lk',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        ...extraHeaders
      }
    });

    ws.on('open', () => {
      console.log(`✅ CONNECTED TO: ${url}`);
      ws.close();
      resolve(true);
    });

    ws.on('error', (err) => {
      console.log(`❌ ERROR on ${url}: ${err.message}`);
      resolve(false);
    });
  });
}

async function run() {
  await test('wss://metrobusapiprod.eimsky.com/ticketing-service/ws');
  await test(`wss://metrobusapiprod.eimsky.com/ticketing-service/ws?token=${token}`);
  await test('wss://metrobusapiprod.eimsky.com/ticketing-service/ws', { 'Authorization': `Bearer ${token}` });
  await test('wss://metrobusapiprod.eimsky.com/ticketing-service/ws/websocket');
  await test('wss://metrobusapiprod.eimsky.com/metrobus-proxy/ticketing-service/ws');
}

run();
