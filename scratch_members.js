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

    const docksRes = await axios.get("https://api.aryankaushik.space/api/docks/my", { headers });
    const docks = docksRes.data;
    const firstDockId = Array.isArray(docks) ? docks[0]?._id || docks[0]?.id : (docks.docks ? docks.docks[0]?._id || docks.docks[0]?.id : null);

    if (firstDockId) {
      const membersRes = await axios.get(`https://api.aryankaushik.space/api/docks/${firstDockId}/members`, { headers });
      console.log("Full members structure (truncated):", JSON.stringify(membersRes.data, null, 2).substring(0, 1000));
    }
  } catch (e) {
    console.error(e.message);
  }
}

run();
