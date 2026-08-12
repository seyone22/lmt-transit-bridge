const axios = require('axios');

const token = "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiYTFmYmY0MWYtMzY2Zi00Mjg9LTllMTMtYWZhNmNlMDAzZDc2IiwiZW1haWwiOiJjdXN0b21lci4wNzY2NzA2ODE2QGludGVybmFsLm1ldHJvYnVzLmxrIiwidXNlcl90eXBlIjoiY3VzdG9tZXIiLCJ0b2tlbl9pZCI6IjI5OWRmNGZkLWRmZDAtNGE0NC1hOTAzLTVkNzY1YmQ2MjE5MyIsImlzcyI6Im50Yy11c2VyLXNlcnZpY2UiLCJzdWIiOiJhMWZiZjQxZi0zNjZmLTQyODktOWUxMy1hZmE2Y2UwMDNkNzYiLCJhdWQiOlsibnRjLWFwaSJdLCJleHAiOjE4MDYxMzkzOTgsIm5iZiI6MTc3NDYwMzM5OCwiaWF0IjoxNzc0NjAzMzk4fQ.Nf8JcXTXOqIKuMibN4xlvirkKd7p56Sj2nHFIZFfWYD0l9SzKqayr6vznNto33aw-hvR5aVGHwoZN_CIr0RqBg";

const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Referer': 'https://lankametro.lk/en/smartmetro',
  'Authorization': `Bearer ${token}`
};

async function testStaticData() {
  console.log("1. Fetching /api/routes...");
  try {
    const r1 = await axios.get('https://lankametro.lk/api/routes', { headers });
    console.log(`Routes length: ${r1.data?.length || 0}`);
    if (r1.data?.[0]) console.log("Sample route:", r1.data[0]);
  } catch (e) { console.error("r1 error:", e.message); }

  console.log("\n2. Fetching /metrobus-proxy/fare-service/api/v1/routes/geo...");
  try {
    const r2 = await axios.get('https://lankametro.lk/metrobus-proxy/fare-service/api/v1/routes/geo', { headers });
    console.log(`Geo routes length: ${r2.data?.data?.length || r2.data?.length || 0}`);
    const sample = r2.data?.data?.[0] || r2.data?.[0];
    if (sample) console.log("Sample geo route:", sample);
  } catch (e) { console.error("r2 error:", e.message); }
}

testStaticData();
