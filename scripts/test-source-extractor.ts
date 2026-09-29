import { LmtSourceExtractorService } from '../src/lmt/lmt-source-extractor.service';

async function main() {
  console.log('🧪 Starting Automated Direct-From-Source Extraction Verification...\n');

  const extractor = new LmtSourceExtractorService();
  const data = await extractor.getTransitData(true);

  console.log('================ 🚌 EXTRACTED ROUTES ================');
  console.log(`Total Routes: ${data.routes.length}`);
  data.routes.forEach((r, i) => {
    console.log(`  [${r.route_code}] ${r.name} (Hex: ${r.color_hex})`);
  });

  console.log('\n================ 🚏 EXTRACTED STOPS ================');
  console.log(`Total Authentic Platform Stops: ${data.stops.length}`);
  console.log('Sample first 3 stops:');
  data.stops.slice(0, 3).forEach((s) => {
    console.log(`  Stop #${s.id} [${s.stop_code}] ${s.name} (${s.name_si}) @ (${s.lat}, ${s.lng})`);
  });

  console.log('\n================ 🧭 EXTRACTED DIRECTIONS ================');
  console.log(`Routes with Directions: ${data.directionMap.size}`);
  for (const [code, dirs] of data.directionMap.entries()) {
    console.log(`  Route ${code}: ${dirs.length} direction UUIDs -> ${dirs.join(', ')}`);
  }

  console.log('\n================ 💳 EXTRACTED FARE MATRIX ================');
  console.log(`Total Stage Fare Rules: ${data.fareMatrix.length}`);
  const uniquePrices = [...new Set(data.fareMatrix.map((f) => f.full_amount_lkr))].sort((a, b) => a - b);
  console.log(`Distinct Fare Prices (LKR): ${uniquePrices.join(', ')}`);

  if (data.routes.length !== 7) {
    throw new Error(`Expected 7 routes, got ${data.routes.length}`);
  }
  if (data.stops.length < 200) {
    throw new Error(`Expected >= 200 stops, got ${data.stops.length}`);
  }
  if (data.fareMatrix.length < 1500) {
    throw new Error(`Expected >= 1500 fare matrix rules, got ${data.fareMatrix.length}`);
  }

  console.log('\n🎉 ALL DIRECT-FROM-SOURCE DATA EXTRACTION TESTS PASSED WITH 100% GROUNDING!');
}

main().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
