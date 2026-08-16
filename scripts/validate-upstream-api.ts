import fs from 'fs';
import path from 'path';
import axios from 'axios';

async function fetchFreshToken(): Promise<string> {
  if (process.env.LMT_JWT_TOKEN && process.env.LMT_JWT_TOKEN.trim().length > 20) {
    return process.env.LMT_JWT_TOKEN.trim();
  }

  console.log('Resolving fresh live JWT from LMT Go via Next.js RSC chunk graph...');
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
  };

  const rscUrl = 'https://lankametro.lk/en/smartmetro/__next.%24d%24locale.smartmetro.__PAGE__.txt?_rsc=1';
  let queue: string[] = [];

  try {
    const rscRes = await axios.get(rscUrl, { headers, timeout: 5000 });
    if (typeof rscRes.data === 'string') {
      const chunkNames = [...new Set(rscRes.data.match(/static\/chunks\/[a-zA-Z0-9_\-\.]+\.js/g) || [])];
      queue = chunkNames.map((c) => `https://lankametro.lk/_next/${c}`);
    }
  } catch (e: any) {
    queue.push('https://lankametro.lk/en/smartmetro');
  }

  const visited = new Set(queue);

  while (queue.length > 0) {
    const chunkUrl = queue.shift()!;
    try {
      const res = await axios.get(chunkUrl, { headers, timeout: 4000 });
      if (typeof res.data === 'string') {
        if (res.data.includes('eyJ')) {
          const tokens = res.data.match(/eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/g);
          if (tokens && tokens.length > 0) {
            for (const tok of tokens) {
              try {
                const parts = tok.split('.');
                if (parts.length >= 2) {
                  const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8'));
                  if (payload.exp && (payload.user_id || payload.sub)) {
                    console.log(`✅ Dynamically resolved fresh JWT (User: ${payload.email || payload.user_id})`);
                    return tok;
                  }
                }
              } catch (e) {}
            }
          }
        }

        const innerChunks = [...new Set(res.data.match(/static\/chunks\/[a-zA-Z0-9_\-\.]+\.js/g) || [])];
        for (const ic of innerChunks) {
          const fullUrl = `https://lankametro.lk/_next/${ic}`;
          if (!visited.has(fullUrl)) {
            visited.add(fullUrl);
            queue.push(fullUrl);
          }
        }
      }
    } catch (e) {}
  }

  throw new Error('Could not resolve fresh JWT token from LMT Go upstream service.');
}

async function validateApiSpec() {
  console.log('🚀 Starting Automated Upstream OpenAPI Specification Health Validation...\n');

  const specPath = path.join(__dirname, '../docs/openapi.json');
  if (!fs.existsSync(specPath)) {
    throw new Error(`OpenAPI spec file not found at ${specPath}`);
  }

  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  const baseUrl = spec.servers[0]?.url || 'https://lankametro.lk/metrobus-proxy';

  const jwtToken = await fetchFreshToken();
  const headers = {
    Authorization: `Bearer ${jwtToken}`,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Referer': 'https://lankametro.lk/en/smartmetro',
    'Origin': 'https://lankametro.lk',
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
