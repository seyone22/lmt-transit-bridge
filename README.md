# Lanka Metro Transit Bridge (lmt-transit-bridge)

## Overview

`lmt-transit-bridge` is a specialized NestJS microservice bridge designed to interface with the Lanka Metro Transit (LMT) Metrobus upstream microservice infrastructure. It extracts real-time bus telemetry, GTFS schedule metadata, stop sequences, dynamic stage fare matrices, driver rosters, and contactless cEMV payment metadata, converting upstream streams into standardized GTFS Schedule and GTFS-Realtime (Vehicle Positions, Trip Updates, Service Alerts) specification formats.

---

## Architecture and Core Services

### 1. Dynamic Authentication (`TokenProviderService`)
- Resolves valid JWT Bearer tokens directly from upstream Next.js React Server Components (RSC) chunk manifests without hardcoded credentials.
- Manages in-memory token lifecycle caching and automatically triggers proactive refresh prior to token expiration.

### 2. Upstream Microservice Integration (`LmtService`)
Communicates with upstream proxies at `https://lankametro.lk/metrobus-proxy`:
- `GET /ticketing-service/api/v1/tickets`: Real-time ticket issuances, fare structures, and contactless cEMV payment metadata (Masked PAN, Auth Code, RRN, Invoice Number, Merchant ID, Terminal ID).
- `GET /ticketing-service/api/v1/buses/{bus_id}/tracking`: Live GPS positions, segment progress fraction, stop-by-stop arrival ETAs, and delay calculations.
- `GET /user-service/api/v1/companies`: Legal corporate identity and registration details for Lanka Metro Transit Pvt Ltd.
- `GET /user-service/api/v1/users?user_type=driver`: Driver roster, contact numbers, and license metadata.
- `GET /fare-service/api/v1/routes`: Trilingual route, stop sequence, and station coordinates (English, Sinhala, Tamil).
- `GET /fare-service/api/v1/categories`: Fleet classification mappings (Metro Bus, Luxury, Semi-Luxury, Regular Bus).

### 3. Automated Weekly GTFS and Fare Rules Sync (`GtfsStaticSyncService`)
- **Automated Cron**: Executes every Sunday at 02:00 AM UTC (`@Cron('0 2 * * 0')`).
- **Data Ingestion**: Synchronizes routes, stops, calendar schedules, fare attributes, and fare rules into PostgreSQL (`slr-transit-server`).
- **Archive Generation**: Triggers automated generation of compliant GTFS static ZIP archives.
- **Manual Endpoint**: REST endpoint `POST /sync/static` for manually triggering sync cycles on demand.

### 4. Realtime Protobuf Publishing (`PublisherService`)
- Encodes upstream vehicle tracking updates into standard GTFS-Realtime Protocol Buffers:
  - Vehicle Positions (`vp`)
  - Trip Updates (`tu`)
  - Service Alerts (`sa`)

---

## API Documentation and Specifications

The project includes an OpenAPI 3.0 specification documenting all internal and upstream proxy endpoints:
- Location: `docs/openapi.json`
- Version: `1.3.0`
- Coverage: Includes detailed JSON schemas for `Ticket`, `CardPaymentDetails`, `BusTracking`, `Company`, `UserRoster`, `BusCategory`, and `GtfsRealtimeMessage`.

---

## Getting Started

### Prerequisites
- Node.js 22 LTS or higher
- npm 10 or higher
- Access to `slr-transit-server` PostgreSQL instance

### Environment Variables
Configure the following variables in `.env`:

```env
PORT=3000
TRANSIT_SERVER_URL=https://slr-transit-server-production.up.railway.app/api/v1
TRANSIT_API_KEY=super-secret-token
LMT_JWT_TOKEN=
```

### Installation

```bash
npm install
```

### Running Locally

```bash
# Development mode
npm run start

# Watch mode
npm run start:dev

# Production build
npm run build
npm run start:prod
```

---

## Testing and Health Checks

### Manual GTFS Static Sync
```bash
curl -X POST http://localhost:3000/sync/static
```

### Upstream OpenAPI Health Validation
Run the automated upstream API validation script:
```bash
npx ts-node scripts/validate-upstream-api.ts
```

### Unit and E2E Tests
```bash
npm run test
npm run test:e2e
```

---

## CI/CD Pipeline

Continuous Integration is managed via GitHub Actions:
- Workflow File: `.github/workflows/api-validation.yml`
- Schedule: Runs weekly every Sunday at 00:00 UTC.
- Environment: Node.js 22 LTS on Ubuntu Latest.

---

## License

Private and Confidential - Lanka Metro Transit Bridge Initiative.
