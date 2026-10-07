import axios from 'axios';
import * as fs from 'fs';

interface HealthResponse {
  status: string;
  service: string;
  timestamp: string;
  upstream: {
    status: string;
    activeBusesCount: number;
    adaptiveCadenceMs: number;
    lastPoll: string | null;
    trackedBuses: string[];
  };
  token: {
    isValid: boolean;
    expiresAt: string | null;
    ttlSeconds: number;
  };
}

interface VehiclePosition {
  trip_id: string;
  route_id?: string;
  vehicle_id: string;
  latitude: number;
  longitude: number;
  speed: number;
  bearing: number;
  timestamp: string;
  updated_at: string;
}

const BRIDGE_URL = process.env.BRIDGE_URL || 'https://lmt-transit-bridge-production.up.railway.app';
const TRANSIT_SERVER_URL = process.env.TRANSIT_SERVER_URL || 'https://api.transit.seyone.dev/api/v1';

async function runSmokeTest(): Promise<void> {
  console.log('====================================================');
  console.log('🚍 Lanka Metro Transit Live Telemetry Daily Smoke Test');
  console.log(`Execution Time: ${new Date().toISOString()}`);
  console.log('====================================================\n');

  const summaryLines: string[] = [];
  summaryLines.push('# 🚍 Daily Live Telemetry Smoke Test Report');
  summaryLines.push(`**Executed at:** ${new Date().toISOString()}\n`);

  let hasFailure = false;

  // --- Step 1: Check LMT Transit Bridge /health ---
  console.log(`1. Checking LMT Bridge Health (${BRIDGE_URL}/health)...`);
  try {
    const healthRes = await axios.get<HealthResponse>(`${BRIDGE_URL}/health`, { timeout: 10000 });
    const health = healthRes.data;

    console.log(`   Status:               ${health.status}`);
    console.log(`   Upstream Health:      ${health.upstream?.status}`);
    console.log(`   Active Buses Tracked: ${health.upstream?.activeBusesCount}`);
    console.log(`   Adaptive Cadence:     ${health.upstream?.adaptiveCadenceMs}ms`);
    console.log(`   Token Valid:          ${health.token?.isValid} (TTL: ${Math.round((health.token?.ttlSeconds || 0) / 86400)} days)`);

    if (health.status !== 'ok' || health.upstream?.status === 'down') {
      throw new Error(`Bridge reported unhealthy status: ${health.status}`);
    }

    if (!health.token?.isValid || (health.token?.ttlSeconds || 0) <= 0) {
      throw new Error('Bridge JWT token is expired or invalid.');
    }

    if ((health.upstream?.activeBusesCount || 0) === 0) {
      throw new Error('Bridge reports 0 active buses currently tracked.');
    }

    summaryLines.push(`- ✅ **Bridge Service**: Healthy (${health.upstream.activeBusesCount} buses in active registry, Cadence: ${health.upstream.adaptiveCadenceMs}ms)`);
    summaryLines.push(`- ✅ **JWT Token**: Valid (Expires: ${health.token.expiresAt})`);
  } catch (err: any) {
    hasFailure = true;
    const msg = `❌ Bridge Health Check Failed: ${err.message}`;
    console.error(`   ${msg}`);
    summaryLines.push(`- ❌ **Bridge Service**: FAILED (${err.message})`);
  }

  // --- Step 2: Check Transit Server Realtime Positions ---
  console.log(`\n2. Checking Transit Server Live Positions (${TRANSIT_SERVER_URL}/realtime/vehicle-positions/list)...`);
  try {
    const posRes = await axios.get<VehiclePosition[]>(`${TRANSIT_SERVER_URL}/realtime/vehicle-positions/list`, {
      timeout: 10000,
    });
    const positions = posRes.data;

    console.log(`   Total Vehicles in Feed: ${positions.length}`);

    if (!Array.isArray(positions) || positions.length === 0) {
      throw new Error('Vehicle positions feed is completely empty ([]). Live data has gone dark!');
    }

    // Check freshness: at least one vehicle must have updated within the last 15 minutes
    const nowMs = Date.now();
    const freshPositions = positions.filter((pos) => {
      const ts = new Date(pos.updated_at || pos.timestamp).getTime();
      return nowMs - ts < 15 * 60 * 1000;
    });

    console.log(`   Fresh Vehicles (<15m):  ${freshPositions.length}/${positions.length}`);

    if (freshPositions.length === 0) {
      throw new Error('All vehicle positions in feed are STALE (> 15 minutes old). Ingestion has halted!');
    }

    summaryLines.push(`- ✅ **Live Vehicle Feed**: ${freshPositions.length} active fresh vehicles streaming on transit server`);

    // Sample list of live buses
    summaryLines.push('\n### Sample Live Buses:');
    summaryLines.push('| Plate | Route | Coordinates | Speed | Last Seen |');
    summaryLines.push('| :--- | :--- | :--- | :--- | :--- |');
    freshPositions.slice(0, 5).forEach((p) => {
      summaryLines.push(
        `| **${p.vehicle_id}** | ${p.route_id || 'N/A'} | ${p.latitude.toFixed(4)}, ${p.longitude.toFixed(4)} | ${p.speed || 0} km/h | ${new Date(p.updated_at).toLocaleTimeString()} |`,
      );
    });
  } catch (err: any) {
    hasFailure = true;
    const msg = `❌ Transit Server Positions Check Failed: ${err.message}`;
    console.error(`   ${msg}`);
    summaryLines.push(`- ❌ **Live Vehicle Feed**: FAILED (${err.message})`);
  }

  // Write GitHub Action Step Summary if running in CI
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryLines.join('\n') + '\n');
    } catch {}
  }

  console.log('\n====================================================');
  if (hasFailure) {
    console.error('🚨 SMOKE TEST FAILED: Live transit telemetry is dark or degraded!');
    console.log('====================================================');
    process.exit(1);
  } else {
    console.log('✅ SMOKE TEST PASSED: All telemetry streams are healthy and live.');
    console.log('====================================================');
  }
}

runSmokeTest();
