const WebSocket = require('ws');

const LMT_JWT_TOKEN =
  process.env.LMT_JWT_TOKEN ||
  'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiYTFmYmY0MWYtMzY2Zi00Mjg5LTllMTMtYWZhNmNlMDAzZDc2IiwiZW1haWwiOiJjdXN0b21lci4wNzY2NzA2ODE2QGludGVybmFsLm1ldHJvYnVzLmxrIiwidXNlcl90eXBlIjoiY3VzdG9tZXIiLCJ0b2tlbl9pZCI6IjI5OWRmNGZkLWRmZDAtNGE0NC1hOTAzLTVkNzY1YmQ2MjE5MyIsImlzcyI6Im50Yy11c2VyLXNlcnZpY2UiLCJzdWIiOiJhMWZiZjQxZi0zNjZmLTQyODktOWUxMy1hZmE2Y2UwMDNkNzYiLCJhdWQiOlsibnRjLWFwaSJdLCJleHAiOjE4MDYxMzkzOTgsIm5iZiI6MTc3NDYwMzM5OCwiaWF0IjoxNzc0NjAzMzk4fQ.Nf8JcXTXOqIKuMibN4xlvirkKd7p56Sj2nHFIZFfWYD0l9SzKqayr6vznNto33aw-hvR5aVGHwoZN_CIr0RqBg';

async function main() {
  const wsUrl = `wss://metrobusapiprod.eimsky.com/ticketing-service/ws?token=${LMT_JWT_TOKEN}`;
  const ws = new WebSocket(wsUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Origin: 'https://lankametro.lk',
    },
  });

  ws.on('open', () => {
    console.log('⚡ Connected!');
  });

  ws.on('message', (data) => {
    const json = JSON.parse(data.toString());
    if (json.type === 'gps_update' && json.payload) {
      console.log('=== RAW WEBSOCKET BUS PAYLOAD ===');
      json.payload.forEach((b) => {
        console.log(`Bus: ${b.registration_number || b.busReg} | Coords: (${b.lat}, ${b.lng}) | Route: ${b.route_id} | Dir: ${b.direction_id}`);
      });
      ws.close();
      process.exit(0);
    }
  });
}

main().catch(console.error);
