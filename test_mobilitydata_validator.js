const axios = require('axios');
const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

async function testMobilityDataValidator() {
  console.log("1. Fetching live GTFS zip feed from production server...");
  const zipPath = path.join(__dirname, 'live_gtfs.zip');
  const reportDir = path.join(__dirname, 'validator-report');

  try {
    const res = await axios.get('https://slr-transit-server-production.up.railway.app/api/v1/gtfs/download', {
      responseType: 'arraybuffer'
    });
    fs.writeFileSync(zipPath, res.data);
    console.log(`Saved GTFS zip feed (${res.data.length} bytes) to ${zipPath}`);
  } catch (err) {
    console.error("Failed to download GTFS feed:", err.message);
    return;
  }

  console.log("\n2. Checking MobilityData GTFS Validator JAR...");
  const jarPath = path.join(__dirname, 'gtfs-validator-6.0.0-cli.jar');
  if (!fs.existsSync(jarPath)) {
    console.log("Downloading MobilityData GTFS Validator v6.0.0 JAR...");
    try {
      const jarRes = await axios.get('https://github.com/MobilityData/gtfs-validator/releases/download/v6.0.0/gtfs-validator-6.0.0-cli.jar', {
        responseType: 'arraybuffer'
      });
      fs.writeFileSync(jarPath, jarRes.data);
      console.log("Downloaded MobilityData GTFS Validator JAR successfully!");
    } catch (e) {
      console.error("Failed to download MobilityData GTFS Validator JAR:", e.message);
      return;
    }
  }

  console.log("\n3. Executing MobilityData GTFS Validator CLI...");
  try {
    const cmd = `java -jar "${jarPath}" --input "${zipPath}" --output_base "${reportDir}"`;
    console.log(`Running: ${cmd}`);
    const output = execSync(cmd, { encoding: 'utf-8' });
    console.log("Validation Output:\n", output);

    const reportJsonPath = path.join(reportDir, 'report.json');
    if (fs.existsSync(reportJsonPath)) {
      const report = JSON.parse(fs.readFileSync(reportJsonPath, 'utf-8'));
      console.log("\n================ 🏆 MOBILITYDATA VALIDATION SUMMARY ================");
      console.log(`Total Errors:   ${report.summary?.errorCount || 0}`);
      console.log(`Total Warnings: ${report.summary?.warningCount || 0}`);
      console.log(`Total Info:     ${report.summary?.infoCount || 0}`);
      if (report.notices) {
        console.log("\nTop Notices:");
        report.notices.slice(0, 5).forEach((n, i) => {
          console.log(` Notice #${i+1}: [${n.severity}] ${n.code} (${n.totalNotices} occurrences)`);
        });
      }
    }
  } catch (cmdErr) {
    console.error("Validation CLI execution error:", cmdErr.stdout || cmdErr.message);
  }
}

testMobilityDataValidator();
