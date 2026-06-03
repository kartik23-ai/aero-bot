const axios = require("axios");

async function run() {
  try {
    const statusRes = await axios.get("http://localhost:8080/api/install/status");
    const token = statusRes.data.accessToken;
    if (!token) return;

    const headers = { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" };
    const docksRes = await axios.get("https://api.aryankaushik.space/api/docks/my", { headers });
    
    const docksList = Array.isArray(docksRes.data) ? docksRes.data : (docksRes.data.docks || []);
    if (docksList.length === 0) return;
    const dockId = docksList[0]._id || docksList[0].id;
    
    const membersRes = await axios.get(`https://api.aryankaushik.space/api/docks/${dockId}/members`, { headers });
    const membersList = Array.isArray(membersRes.data) ? membersRes.data : (membersRes.data.members || []);
    
    const regularMember = membersList.find(m => m.role === "member" && m.user?.username !== "aerogroupguard");
    
    if (regularMember) {
      const userId = regularMember.user?._id || regularMember.user?.id;
      console.log(`Target User: ${regularMember.user?.username} (${userId})`);
      
      const tests = [
        { method: "POST", url: `https://api.aryankaushik.space/api/docks/${dockId}/members/${userId}/ban`, data: {} },
        { method: "POST", url: `https://api.aryankaushik.space/api/docks/${dockId}/members/${userId}/mute`, data: { duration: 60 } }, // duration in seconds/minutes?
        { method: "POST", url: `https://api.aryankaushik.space/api/docks/${dockId}/members/${userId}/unmute`, data: {} }
      ];

      for (const t of tests) {
        try {
          const res = await axios.post(t.url, t.data, { headers });
          console.log(`✅ Success POST ${t.url}:`, res.status, res.data);
        } catch (err) {
          console.log(`❌ Failed POST ${t.url}:`, err.response?.status, err.response?.data?.message || err.response?.data?.error || err.message);
        }
      }
    }
  } catch (e) {
    console.error(e.message);
  }
}

run();
