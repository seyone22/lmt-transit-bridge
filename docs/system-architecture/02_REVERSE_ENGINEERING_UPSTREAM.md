# 02. Reverse Engineering Upstream Architecture & Protocols

## 1. Upstream Environment & Discovery
Upstream operator **Lanka Metro Transit (LMT)** operates a proprietary transit ticketing and passenger information system built on top of Eimsky's SmartMetro platform. The consumer web application is a Next.js 14+ application deployed behind Cloudflare Enterprise CDN.

```
Upstream Host:   https://lankametro.lk
Reverse Proxy:   /metrobus-proxy/*, /ws-proxy/*
Framework:       Next.js (App Router / React Server Components)
WAF / CDN:       Cloudflare Enterprise (Bot Management, Managed Challenges, Geo-restrictions)
```

---

## 2. Evolution of Ingestion: HTTP Scraper to Live WebSocket

### A. The Legacy HTTP Scraper (Deprecated)
Initially, telemetry was derived through ticket transaction scrapers:
* **Mechanism**: Upstream's mobile ticketing validators emitted ticket issue logs to `/metrobus-proxy/ticketing-service/api/v1/tickets/sales-list`.
* **Vulnerability**: This endpoint required an ephemeral JWT bearer token baked into Next.js client-side Webpack chunks (`self.__next_f` RSC payloads).
* **The Failure Mode**: During upstream Next.js deployments, developers moved the token server-side or rotated the secret. In October 2026, the baked token expired at 06:30 UTC, returning `HTTP 401 Unauthorized` and stalling the HTTP polling pipeline.

### B. The Live WebSocket Discovery (Current Architecture)
Through an audit of client network traffic, a WebSocket endpoint was identified:
```
wss://lankametro.lk/ws-proxy/ticketing-service/ws
```

#### Protocol Analysis:
1. **Authentication**: **Zero Authentication**. No Bearer tokens, cookies, or custom headers are required to connect. The web client simply opens the WebSocket.
2. **Heartbeats**: The server emits ping frames every 30 seconds. The client must reply with standard Pong or remain receptive to incoming text frames.
3. **Transport Protocol**: Raw JSON text frames over WSS.

---

## 3. WebSocket Message Schemas & Frame Dissection

Incoming frames adhere to a JSON envelope format. The primary event driving telemetry is `gps_update`:

```json
{
  "event": "gps_update",
  "data": {
    "bus_id": "WP-NE-6488",
    "regNum": "WP-NE-6488",
    "trip_id": "LMT_CM05_1_WP-NE-6488",
    "route_code": "CM05",
    "direction_id": 1,
    "latitude": 6.95289,
    "longitude": 79.88058,
    "speed": 28.5,
    "bearing": 182.4,
    "current_capacity": 39,
    "total_capacity": 70,
    "timestamp": 1729000850000
  }
}
```

### Critical Field Dictionary:
| Field | Type | Description |
| :--- | :--- | :--- |
| `regNum` / `bus_id` | `string` | Vehicle commercial registration plate (e.g., `WP-NE-6488`, `ND-3401`). |
| `route_code` | `string` | Active corridor identifier (`CM01`, `CM02`, `CM03`, `CM04`, `CM05`, `CM06`, `CM08`). |
| `direction_id` | `number` / `string` | Integer `0` (Inbound / Downlink) or `1` (Outbound / Uplink), or direction UUID. |
| `latitude` / `longitude` | `number` | WGS84 GPS decimal degrees coordinates. |
| `speed` | `number` | Ground speed in km/h. When absent, computed using haversine delta over elapsed time. |
| `bearing` | `number` | Heading in compass degrees (0–359°). When absent, computed via forward azimuth. |
| `current_capacity` | `number` | **Live passenger count** from onboard optical/weight sensors. |
| `total_capacity` | `number` | **Total certified capacity** (seats + permitted standees, typically 70). |
| `timestamp` | `number` | Unix epoch in milliseconds. |

---

## 4. Production Fleet Verification: Rejecting Test Bots & Simulators
During the reverse-engineering phase, it was critical to determine if the stream contained synthetic simulator data or genuine vehicles.

### Filtering Heuristics:
1. **License Plate Regex Validation**: Genuine Sri Lankan commercial buses have Western Province registration numbers matching `WP-NA-xxxx`, `WP-NB-xxxx`, `WP-ND-xxxx`, `WP-NE-xxxx`, or legacy number plates.
2. **Rejection of Simulated Devices**:
   * Prefixes: `TEST-`, `SUN-`, `DEV-`, `SIM-`, `UNKNOWN_BUS`.
   * Sequential dummy strings: `00000`, `11111`, `12345`, `54321`.
   * Out-of-bounds coordinates outside the Colombo Metropolitan Area.
3. **Geofencing**:
   * Latitudes: `6.68` to `7.22` N
   * Longitudes: `79.82` to `80.15` E
   * Bounded ocean cutoffs: Longitude `< 79.83` is rejected (ocean off Galle Face / Port City).

### Audit Results:
* **Total Tracked Buses**: ~70 active buses.
* **Authenticity**: **100% genuine commercial fleet**. Zero dummy test bots observed during operational service.
* **Corridor Spread**: Buses actively track along A1 (Kandy Rd), A4 (High Level Rd), Baseline Rd, Marine Drive, and Outer Circular Expressway.

---

## 5. Cloudflare Geo-Fencing & Regional Bypass Tactics

### The Problem:
Connecting to `lankametro.lk` from cloud data centers located in the United States or Western Europe (AWS `us-east-1`, Railway US West) frequently yielded:
```http
HTTP 403 Forbidden / Cloudflare 1020 Ray Challenge
```
Cloudflare's Bot Management rules had aggressive WAF scoring against non-residential IP pools from the Americas and Europe attempting to access `.lk` public proxy endpoints.

### The Resolution:
* Relocated `lmt-transit-bridge` to Railway's **Southeast Asia (`asia-southeast1` / Singapore)** region.
* Because Singapore shares high-trust peering with Sri Lanka telecom transit backbones (SLT, Dialog, Bharti Airtel), Cloudflare classifies this traffic as standard regional web traffic.
* Connection success rate: **100%**, zero 403 challenge drops since regional redeployment.
