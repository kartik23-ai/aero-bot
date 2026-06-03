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

    const targetUserId = "6a040cc5ea8cb0a319b0bb71"; // yamdut
    const paths = [
      `/docks/personal/${targetUserId}`,
      `/docks/dm/${targetUserId}`,
      `/docks/with/${targetUserId}`,
      `/docks/user/${targetUserId}`,
      `/chats/${targetUserId}`,
      `/docks/my?type=personal`,
      `/docks/my?type=dm`,
      `/docks/my?type=personal-chat`,
      `/docks/personal`,
      `/docks/dms`
    ];

    for (const p of paths) {
      try {
        const res = await axios.get(`https://api.aryankaushik.space/api${p}`, { headers });
        console.log(`Endpoint GET ${p} SUCCESS:`, typeof res.data, JSON.stringify(res.data).substring(0, 150));
      } catch (err) {
        console.log(`Endpoint GET ${p} FAILED:`, err.message, err.response?.data?.message || err.response?.data?.error || "");
      }
    }

  } catch (e) {
    console.error(e.message);
  }
}

run();
