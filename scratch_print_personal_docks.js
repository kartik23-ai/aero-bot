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

    const res = await axios.get("https://api.aryankaushik.space/api/docks/my?type=personal", { headers });
    const docks = res.data.docks || res.data || [];
    console.log("Personal docks keys/details:", JSON.stringify(docks, null, 2));

  } catch (e) {
    console.error(e.message);
  }
}

run();
