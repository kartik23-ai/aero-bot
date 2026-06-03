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
      const msgsRes = await axios.get(`https://api.aryankaushik.space/api/docks/${firstDockId}/messages?limit=2`, { headers });
      console.log("Full message structure:", JSON.stringify(msgsRes.data.messages[0], null, 2));
    }
  } catch (e) {
    console.error(e.message);
  }
}

run();
