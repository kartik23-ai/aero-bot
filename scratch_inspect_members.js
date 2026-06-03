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
    console.log("Found docks:", docksList.map(d => ({ id: d._id || d.id, name: d.name })));

    for (const d of docksList) {
      const dockId = d._id || d.id;
      const membersRes = await axios.get(`https://api.aryankaushik.space/api/docks/${dockId}/members`, { headers });
      const members = Array.isArray(membersRes.data) ? membersRes.data : (membersRes.data?.members || []);
      console.log(`\nMembers for dock ${d.name} (${dockId}):`);
      members.forEach(m => {
        console.log(`- User: ${m.user?.username} (${m.user?._id}), Role: ${m.role}, isAdmin: ${m.isAdmin}`);
      });
    }
  } catch (e) {
    console.error(e.message);
  }
}

run();
