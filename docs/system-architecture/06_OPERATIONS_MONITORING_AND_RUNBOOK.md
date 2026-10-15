# 06. Operations, Monitoring & Runbook

## 1. Production Deployment Topology

Both services run on Railway's managed cloud infrastructure with private networking and environment variable security.

```
+-------------------------------------------------------------------------+
| Railway Cloud Environment                                               |
|                                                                         |
|  [lmt-transit-bridge] (Region: asia-southeast1 / Singapore)             |
|    - RAM: 512 MB | vCPU: 0.5                                            |
|    - Public Domain:  https://lmt-transit-bridge-production.up.railway.app|
|    - Private Domain: lmt-transit-bridge.railway.internal                |
|           |                                                             |
|           | (Private Railway Virtual Network)                           |
|           v                                                             |
|  [slr-transit-server] (Region: us-east1 / Primary DB Proxy)             |
|    - RAM: 1024 MB | vCPU: 1.0                                           |
|    - Public Domain:  https://api.transit.seyone.dev                     |
|    - Private Domain: slr-transit-server.railway.internal:8080           |
|           |                                                             |
|           v                                                             |
|  [PostgreSQL 16 Managed DB] (Schemas: public, schema_lmt)                |
+-------------------------------------------------------------------------+
```

---

## 2. Environment Variables & Secret Configuration

### `lmt-transit-bridge`:
| Variable | Production Value | Purpose |
| :--- | :--- | :--- |
| `LMT_WS_URL` | `wss://lankametro.lk/ws-proxy/ticketing-service/ws` | Live WebSocket upstream feed URL. |
| `TRANSIT_SERVER_URL` | `http://slr-transit-server.railway.internal:8080/api/v1` | Private internal API endpoint. |
| `TRANSIT_API_KEY` | `[SECURED]` | Internal authentication token for bridge publishing. |
| `RAILWAY_REGION` | `asia-southeast1` | Regional routing avoiding Cloudflare bot bans. |

### `slr-transit-server`:
| Variable | Purpose |
| :--- | :--- |
| `DATABASE_URL` | PostgreSQL connection string (`postgresql://postgres:...`). |
| `API_KEY` | Secret validation token for inbound write endpoints. |
| `R2_ENDPOINT` / `R2_KEY` / `R2_SECRET` | Cloudflare R2 bucket credentials for static zip backup. |
| `PORT` | Container HTTP listen port (Default: `8080`). |

---

## 3. Automated Daily Smoke Testing

The platform includes an automated end-to-end smoke test script:
```bash
npx ts-node scripts/smoke-test-live-telemetry.ts
```

### What It Verifies:
1. **Bridge Health Check (`/health`)**:
   * Confirms `status: "ok"` and `upstream_health: "healthy"`.
   * Verifies `transport_engine: "websocket"`.
   * Asserts `active_buses_tracked >= 30` during operational hours.
2. **Transit Server Live Feed (`/api/v1/realtime/vehicle-positions/list`)**:
   * Fetches the entire JSON vehicle array.
   * Asserts `total_vehicles >= 30`.
   * Calculates freshness: verifies `fresh_vehicles >= 25` with GPS timestamps younger than 15 minutes.
3. **Exit Code**: Returns `0` on success, `1` on failure (triggering CI/CD alert notifications).

---

## 4. Operational Incident Runbook

### Incident A: Bridge Health Reports `degraded` or `0 Active Buses`
* **Symptoms**: Smoke test fails with `Active Buses Tracked: 0`.
* **Root Causes**:
  1. Off-peak service hours (00:00 to 04:30 IST): Buses are in depot, engines off.
  2. Upstream WebSocket proxy connection dropped.
* **Resolution Steps**:
  1. Check local Colombo time: if between midnight and 04:30 AM, this is normal operational shutdown.
  2. Check Bridge logs: `railway logs --service lmt-transit-bridge`. Look for `"WebSocket error"` or `"Reconnecting in..."`.
  3. If connection is refused, verify upstream web client at `https://lankametro.lk/en/smartmetro`.

### Incident B: Upstream Redeployment Changes JavaScript Chunks
* **Symptoms**: Extraction logs show `Could not find routes array in upstream chunk`.
* **Root Cause**: Upstream Next.js deployed a new build with new chunk hashes.
* **Resolution Steps**:
  1. Run `npx ts-node scripts/test-source-extractor.ts`.
  2. The service dynamically inspects the landing page and RSC stream to locate the new chunk URL automatically.
  3. If the regex fails due to an upstream variable rename, inspect the new chunk in `scripts/test-source-extractor.ts` and adjust the bundle array regex pattern.

### Incident C: Vehicle Positions Not Appearing in Google / Apple Maps
* **Symptoms**: Static routes appear, but buses do not move on the map.
* **Root Causes**: Protobuf endpoint returning empty dataset or stale cache.
* **Resolution Steps**:
  1. Inspect binary Protobuf feed:
     ```bash
     curl -s https://api.transit.seyone.dev/api/v1/realtime/vehicle-positions | head -c 50
     ```
  2. Query JSON vehicle list:
     ```bash
     curl -s https://api.transit.seyone.dev/api/v1/realtime/vehicle-positions/list
     ```
  3. Verify that `updated_at` timestamps are within the last 5 minutes.
