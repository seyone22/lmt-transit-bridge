# 04. Static GTFS & Exact Fares Engine

## 1. Automated Upstream Extraction (`LmtSourceExtractorService`)

Instead of manually maintaining route coordinates, stop lists, and fare tables, the platform uses an automated extraction service: [`LmtSourceExtractorService`](file:///c:/Users/SGSey/WebstormProjects/lmt-transit-bridge/src/lmt/lmt-source-extractor.service.ts).

### Extraction Workflow
1. **Dynamic Chunk Discovery**: Inspects `https://lankametro.lk/en/smartmetro` and React Server Component payloads to discover the latest route and fare JavaScript chunk hash (e.g., `1q-24_f9t-suo.js`).
2. **Regex Ast Extraction**: Parses minified bundle arrays for:
   * 7 Master Routes (names, codes, brand hex colors).
   * 220 Platform Stops (IDs, stop codes, Sinhala/Tamil/English names, exact GPS coordinates).
   * Direction UUIDs and canonical routing maps.
   * Full 2,575 Stop-to-Stop Fare Rules Matrix.
3. **In-Memory Caching**: Caches extracted transit metadata for 24 hours, automatically refreshing if forced or when upstream deploys a new chunk bundle.

---

## 2. The Complete 2,575 Stop-to-Stop Fare Matrix

Upstream defines exact Origin-to-Destination (OD) fares between all pairs of stations across its network.

### Route Breakdown
| Route Code | Corridor Description | Exact Fare Rules |
| :---: | :--- | :---: |
| **`CM01`** | Makumbura Multimodal Center ➔ Colombo Fort | **400** |
| **`CM02`** | Millenium City (Athurugiriya) ➔ Colombo Fort | **462** |
| **`CM03`** | Makumbura ➔ Kadawatha Expressway Express | **441** |
| **`CM04`** | Panadura ➔ Dematagoda Arterial | **306** |
| **`CM05`** | Ekala ➔ Battaramulla Express | **420** |
| **`CM06`** | Kollupitiya Circular Route | **240** |
| **`CM08`** | Kahathuduwa Interchange ➔ Pettah Terminal | **306** |
| **Total** | **All 7 Active Corridors** | **2,575** |

### Distinct Fare Tiers (`fare_attributes.txt`)
The 2,575 stop-pairs compress into **18 distinct price points**:
```
65 LKR, 85 LKR, 110 LKR, 135 LKR, 160 LKR, 185 LKR, 210 LKR,
225 LKR, 240 LKR, 255 LKR, 270 LKR, 285 LKR, 300 LKR, 315 LKR,
330 LKR, 345 LKR, 360 LKR, 375 LKR
```
Each price is generated in `fare_attributes.txt` as `FARE_LMT_<PRICE>_LKR` with `currency_type: "LKR"`, `payment_method: 0` (paid onboard/POS validator), and `transfers: 0`.

---

## 3. Handling Upstream Stop ID Re-Indexing
During network expansions, upstream occasionally re-indexes numerical stop IDs. For example:
* **Old ID `135`**: Originally `Peliyagoda (New Kelani Bridge)` ➔ Reassigned to `CTB Junction (Ekala)`.
* **New ID `145`**: Assigned to `Peliyagoda (New Kelani Bridge)` (`ETB101`).

### Synchronization Protocol
* The platform aligns the database `lmtStop` table directly with the live chunk manifest so that `origin_id` and `destination_id` in `fare_rules.txt` match canonical stop numbers (`1` to `220`).
* In `stops.txt`, every stop has `zone_id = stop_id`. This allows standard GTFS Fares V1 consumers to identify exact stop-to-stop OD pricing rules without ambiguous stage zones.

---

## 4. GTFS Static Package Export (`/api/v1/gtfs/export?agencyId=LMT`)

When requested, [`GtfsService`](file:///c:/Users/SGSey/WebstormProjects/slr-transit-server/src/modules/gtfs/gtfs.service.ts) generates a fully compliant GTFS static `.zip` archive containing:

| GTFS Static File | Purpose & Contents |
| :--- | :--- |
| `agency.txt` | Lanka Metro Transit Pvt Ltd official metadata, timezone (`Asia/Colombo`), contact URL. |
| `routes.txt` | 7 active corridors with route codes, full titles, and brand hex colors. |
| `stops.txt` | 220 platform stops and parent station hubs (e.g. `STATION_MAKUMBURA`). |
| `trips.txt` | Direction-bound trip definitions mapped to service calendar IDs. |
| `stop_times.txt` | Station sequence progression and arrival/departure schedule timings. |
| `fare_attributes.txt` | 18 price tiers (65 LKR to 375 LKR). |
| `fare_rules.txt` | **2,575 stop-pair fare rules** with exact `origin_id` and `destination_id`. |
| `shapes.txt` | High-fidelity GPS route polyline shape coordinates. |
| `calendar.txt` | Weekly operating schedule (`SERV_LMT_DAILY`). |
| `transfers.txt` | Platform transfer walk times at terminal hubs (e.g. Makumbura MMC). |
| `translations.txt` | Trilingual stop names in English, Sinhala (සිංහල), and Tamil (தமிழ்). |
| `feed_info.txt` | Feed publisher details, licensing, and validity date bounds. |

---

## 5. Public Stop-to-Stop Fare Lookup API

For client applications, mobile apps, and booking widgets that need instant pricing without parsing the entire GTFS zip, the server exposes a dedicated fare lookup endpoint:

```http
GET /api/v1/fares/lookup?origin_id=145&destination_id=30
```

### Sample Response:
```json
{
  "found": true,
  "fare_id": "FARE_LMT_110_LKR",
  "route_id": "c0050000-0000-4000-8000-000000000005",
  "origin_id": "145",
  "destination_id": "30",
  "price_lkr": 110,
  "currency": "LKR"
}
```
* **Bidirectional Fallback**: Automatically checks both inbound and outbound directions if the stop pair order is inverted.
* **Corridor Filtering**: Supports optional `&route_id=...` parameter when multiple routes serve the same stop pair.
