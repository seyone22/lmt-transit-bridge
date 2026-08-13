const { chromium } = require('playwright');
const axios = require('axios');

(async () => {
  console.log("Acquiring fresh session token to analyze yesterday (2026-08-12) and today (2026-08-13) bus schedules...\n");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  let token = null;

  page.on('websocket', ws => {
    const url = ws.url();
    const match = url.match(/token=(eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*)/);
    if (match && match[1]) token = match[1];
  });

  try {
    await page.goto('https://lankametro.lk/en/smartmetro', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
  } catch (err) {
    console.error("Browser error:", err.message);
  } finally {
    await browser.close();
  }

  if (!token) {
    console.error("Failed to acquire token from browser session.");
    return;
  }

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer': 'https://lankametro.lk/en/smartmetro',
    'Authorization': `Bearer ${token}`
  };

  const routes = [
    { id: "8bc594e3-8ad6-4a0d-9138-bf8b4247e2f5", name: "Maharagama - Kadawatha Corridor" },
    { id: "f3eaf277-a6fa-4f5b-8a61-3b1758d9a4b8", name: "Fort - Battaramulla Express" }
  ];

  async function getSchedule(dateStr, routeId) {
    const url = `https://lankametro.lk/metrobus-proxy/ticketing-service/api/v1/bus-schedule-assignments/daily-schedule?date=${dateStr}&route_id=${routeId}`;
    try {
      const res = await axios.get(url, { headers });
      const raw = res.data;
      if (Array.isArray(raw)) return raw;
      if (Array.isArray(raw.data)) return raw.data;
      if (typeof raw.data === 'object') return Object.values(raw.data);
      return [];
    } catch (e) {
      console.error(`Error fetching schedule for ${dateStr} (route ${routeId.slice(0,8)}):`, e.response?.status, e.response?.data || e.message);
      return [];
    }
  }

  console.log("================ 📅 YESTERDAY (2026-08-12) SCHEDULE ANALYSIS ================");
  let yesterdayTrips = [];
  for (const r of routes) {
    const trips = await getSchedule("2026-08-12", r.id);
    console.log(`Route '${r.name}': ${trips.length} scheduled trips`);
    if (Array.isArray(trips)) {
      trips.forEach(t => yesterdayTrips.push({ ...t, route_name: r.name }));
    }
  }

  console.log("\n================ 📅 TODAY (2026-08-13) SCHEDULE ANALYSIS ================");
  let todayTrips = [];
  for (const r of routes) {
    const trips = await getSchedule("2026-08-13", r.id);
    console.log(`Route '${r.name}': ${trips.length} scheduled trips`);
    if (Array.isArray(trips)) {
      trips.forEach(t => todayTrips.push({ ...t, route_name: r.name }));
    }
  }

  console.log("\n================ 📊 DATABASE LOGS ANALYSIS ================");
  try {
    const dbRes = await axios.get('https://slr-transit-server-production.up.railway.app/api/v1/realtime/vehicle-positions/list');
    const allPositions = dbRes.data || [];
    console.log(`Total stored vehicle position logs in PostgreSQL: ${allPositions.length}`);

    const yesterdayLogs = allPositions.filter(p => {
      const d = new Date(p.updated_at || p.timestamp);
      return d.getUTCFullYear() === 2026 && d.getUTCMonth() === 7 && d.getUTCDate() === 12;
    });

    const todayLogs = allPositions.filter(p => {
      const d = new Date(p.updated_at || p.timestamp);
      return d.getUTCFullYear() === 2026 && d.getUTCMonth() === 7 && d.getUTCDate() === 13;
    });

    console.log(`Yesterday (Aug 12) recorded bus updates: ${yesterdayLogs.length}`);
    console.log(`Today (Aug 13) recorded bus updates:     ${todayLogs.length}`);

    if (yesterdayLogs.length > 0) {
      yesterdayLogs.sort((a, b) => new Date(a.updated_at || a.timestamp) - new Date(b.updated_at || b.timestamp));
      const lastYesterdayBus = yesterdayLogs[yesterdayLogs.length - 1];
      console.log(`\n🔴 LAST BUS YESTERDAY STOPPED AT: ${new Date(lastYesterdayBus.updated_at || lastYesterdayBus.timestamp).toISOString()}`);
      console.log(`   Vehicle ID: ${lastYesterdayBus.vehicle_id || lastYesterdayBus.trip_id}`);
      console.log(`   Trip ID:    ${lastYesterdayBus.trip_id}`);
      console.log(`   Location:   (${lastYesterdayBus.latitude}, ${lastYesterdayBus.longitude})`);
    }

    if (todayLogs.length > 0) {
      todayLogs.sort((a, b) => new Date(a.updated_at || a.timestamp) - new Date(b.updated_at || b.timestamp));
      const firstTodayBus = todayLogs[0];
      console.log(`\n🟢 FIRST BUS TODAY DEPARTED/INGESTED AT: ${new Date(firstTodayBus.updated_at || firstTodayBus.timestamp).toISOString()}`);
      console.log(`   Vehicle ID: ${firstTodayBus.vehicle_id || firstTodayBus.trip_id}`);
      console.log(`   Trip ID:    ${firstTodayBus.trip_id}`);
      console.log(`   Location:   (${firstTodayBus.latitude}, ${firstTodayBus.longitude})`);
    }
  } catch (err) {
    console.error("DB error:", err.message);
  }
})();
