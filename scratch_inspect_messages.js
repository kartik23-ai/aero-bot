const axios = require("axios");

async function run() {
  try {
    const statusRes = await axios.get("http://localhost:8080/api/install/status");
    const token = statusRes.data.accessToken;
    if (!token) {
      console.log("No token found");
      return;
    }

    const headers = {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    };

    const docksRes = await axios.get("https://api.aryankaushik.space/api/docks/my", { headers });
    const docks = docksRes.data;
    const docksList = Array.isArray(docks) ? docks : (docks.docks || []);
    if (docksList.length === 0) {
      console.log("No docks found");
      return;
    }
    const dockId = docksList[0]._id || docksList[0].id;
    console.log("Testing limit=500 on dock:", dockId);
    const msgsRes = await axios.get(`https://api.aryankaushik.space/api/docks/${dockId}/messages?limit=500`, { headers });
    const msgs = msgsRes.data.messages || msgsRes.data || [];
    console.log("Returned messages count:", msgs.length);
    if (msgs.length > 0) {
      console.log("Newest message date:", msgs[0].createdAt);
      console.log("Oldest message date:", msgs[msgs.length - 1].createdAt);
    }
  } catch (e) {
    console.error(e.message);
  }
}

run();
