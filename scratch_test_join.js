const axios = require("axios");

async function run() {
  try {
    const statusRes = await axios.get("http://localhost:8080/api/install/status");
    const token = statusRes.data.accessToken;
    if (!token) return;

    const headers = { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" };
    
    // We can try to hit some join endpoints with a dummy code:
    const tests = [
      { url: "https://api.aryankaushik.space/api/docks/join", data: { inviteCode: "123" } },
      { url: "https://api.aryankaushik.space/api/docks/join", data: { code: "123" } },
      { url: "https://api.aryankaushik.space/api/docks/join/123", data: {} }
    ];

    for (const t of tests) {
      try {
        const res = await axios.post(t.url, t.data, { headers });
        console.log(`✅ Success POST ${t.url}:`, res.status, res.data);
      } catch (err) {
        console.log(`❌ Failed POST ${t.url}:`, err.response?.status, err.response?.data?.message || err.response?.data?.error || err.message);
      }
    }
  } catch (e) {
    console.error(e.message);
  }
}

run();
