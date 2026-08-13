import fs from 'fs';
import path from 'path';
import axios from 'axios';

const LMT_JWT_TOKEN =
  process.env.LMT_JWT_TOKEN ||
  'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiYTFmYmY0MWYtMzY2Zi00Mjg5LTllMTMtYWZhNmNlMDAzZDc2IiwiZW1haWwiOiJjdXN0b21lci4wNzY2NzA2ODE2QGludGVybmFsLm1ldHJvYnVzLmxrIiwidXNlcl90eXBlIjoiY3VzdG9tZXIiLCJ0b2tlbl9pZCI6IjI5OWRmNGZkLWRmZDAtNGE0NC1hOTAzLTVkNzY1YmQ2MjE5MyIsImlzcyI6Im50Yy11c2VyLXNlcnZpY2UiLCJzdWIiOiJhMWZiZjQxZi0zNjZmLTQyODktOWUxMy1hZmE2Y2UwMDNkNzYiLCJhdWQiOlsibnRjLWFwaSJdLCJleHAiOjE4MDYxMzkzOTgsIm5iZiI6MTc3NDYwMzM5OCwiaWF0IjoxNzc0NjAzMzk4fQ.Nf8JcXTXOqIKuMibN4xlvirkKd7p56Sj2nHFIZFfWYD0l9SzKqayr6vznNto33aw-hvR5aVGHwoZN_CIr0RqBg';

async function validateApiSpec() {
  console.log('🚀 Starting Automated Upstream OpenAPI Specification Health Validation...\n');

  const specPath = path.join(__dirname, '../docs/openapi.json');
  if (!fs.existsSync(specPath)) {
    throw new Error(`OpenAPI spec file not found at ${specPath}`);
  }

  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  const baseUrl = spec.servers[0]?.url || 'https://lankametro.lk/metrobus-proxy';

  const headers = {
    Authorization: `Bearer ${LMT_JWT_TOKEN}`,
    'User-Agent': 'lmt-transit-bridge-validator/1.0',
    Accept: 'application/json',
  };

  const sampleValues: Record<string, string> = {
    bus_id: '713fc0cb-b1cc-4460-a0d8-8df4b9779a52', // WP-NE-5235
    route_id: '8bc594e3-8ad6-4a0d-9138-bf8b4247e2f5', // CM01
    direction_id: 'fe423b83-34e7-4bd5-816b-97968dcd2b1f',
    user_type: 'driver',
  };

  let passed = 0;
  let failed = 0;

  for (const [pathStr, methods] of Object.entries<any>(spec.paths)) {
    if (methods.get) {
      let resolvedPath = pathStr;
      const queryParams: string[] = [];

      for (const p of methods.get.parameters || []) {
        if (p.in === 'path') {
          const val = sampleValues[p.name] || 'default';
          resolvedPath = resolvedPath.replace(`{${p.name}}`, val);
        } else if (p.in === 'query') {
          const val = sampleValues[p.name] || 'default';
          queryParams.push(`${p.name}=${val}`);
        }
      }

      let url = pathStr.startsWith('/gcs-proxy')
        ? `https://lankametro.lk${pathStr}`
        : `${baseUrl}${resolvedPath}`;

      if (queryParams.length > 0) {
        url += `?${queryParams.join('&')}`;
      }

      try {
        const resp = await axios.get(url, { headers, timeout: 5000 });
        if (resp.status === 200) {
          console.log(`✅ [200 OK]: ${url}`);
          passed++;
        } else {
          console.warn(`⚠️ [Status ${resp.status}]: ${url}`);
          passed++;
        }
      } catch (err: any) {
        console.error(`❌ [FAILED]: ${url} -> ${err.message}`);
        failed++;
      }
    }
  }

  console.log(`\n================ 📊 OPENAPI VALIDATION SUMMARY ================`);
  console.log(`✅ Passed Endpoints: ${passed}`);
  console.log(`❌ Failed Endpoints: ${failed}`);
  console.log(`==============================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

validateApiSpec().catch((err) => {
  console.error(err);
  process.exit(1);
});
