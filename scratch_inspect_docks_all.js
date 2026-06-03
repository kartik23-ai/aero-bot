const axios = require("axios");

async function run() {
  try {
    const statusRes = await axios.get("http://localhost:8080/api/install/status");
    const token = statusRes.data.accessToken;
    if (!token) return;

    const headers = {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    };

    const endpoints = [
      "/docks/requests",
      "/docks/pending",
      "/docks/invites",
      "/docks/conversations",
      "/conversations",
      "/docks/my/requests",
      "/docks/my/pending"
    ];

    for (const ep of endpoints) {
      try {
        const res = await axios.get(`https://api.aryankaushik.space/api${ep}`, { headers });
        console.log(`Endpoint GET ${ep} SUCCESS:`, typeof res.data, JSON.stringify(res.data).substring(0, 200));
      } catch (err) {
        console.log(`Endpoint GET ${ep} FAILED:`, err.message, err.response?.data?.message || err.response?.data?.error || "");
      }
    }

  } catch (e) {
    console.error(e.message);
  }
}

run();
