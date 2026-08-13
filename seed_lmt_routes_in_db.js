const axios = require('axios');

const baseUrl = 'https://slr-transit-server-production.up.railway.app/api/v1';
const apiKey = 'super-secret-token';
const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${apiKey}`,
};

async function seedLmtData() {
  console.log("1. Upserting Agency LMT...");
  try {
    const agencyRes = await axios.post(`${baseUrl}/agency`, {
      agency_id: 'LMT',
      agency_name: 'Lanka Metro Transit',
      agency_url: 'https://lankametro.lk',
      agency_timezone: 'Asia/Colombo',
      agency_lang: 'en',
    }, { headers });
    console.log("Agency LMT created/updated:", agencyRes.data);
  } catch (e) {
    console.error("Agency error:", e.response?.status, e.response?.data || e.message);
  }

  console.log("\n2. Upserting Route CM01...");
  try {
    const cm01Res = await axios.post(`${baseUrl}/routes`, {
      route_id: '8bc594e3-8ad6-4a0d-9138-bf8b4247e2f5',
      agency_id: 'LMT',
      route_short_name: 'CM01',
      route_long_name: 'Makumbura – Maharagama – Nugegoda – Borella – Kadawatha Corridor',
      route_type: 3,
      route_color: '008080',
      route_text_color: 'FFFFFF',
    }, { headers });
    console.log("Route CM01 created/updated:", cm01Res.data);
  } catch (e) {
    console.error("CM01 error:", e.response?.status, e.response?.data || e.message);
  }

  console.log("\n3. Upserting Route CM02...");
  try {
    const cm02Res = await axios.post(`${baseUrl}/routes`, {
      route_id: 'f3eaf277-a6fa-4f5b-8a61-3b1758d9a4b8',
      agency_id: 'LMT',
      route_short_name: 'CM02',
      route_long_name: 'Pettah – Fort – Rajagiriya – Battaramulla – Kottawa Express',
      route_type: 3,
      route_color: 'FF4500',
      route_text_color: 'FFFFFF',
    }, { headers });
    console.log("Route CM02 created/updated:", cm02Res.data);
  } catch (e) {
    console.error("CM02 error:", e.response?.status, e.response?.data || e.message);
  }
}

seedLmtData();
