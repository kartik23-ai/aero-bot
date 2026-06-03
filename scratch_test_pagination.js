const axios = require("axios");

async function run() {
  try {
    const statusRes = await axios.get("http://localhost:8080/api/install/status");
    const token = statusRes.data.accessToken;
    if (!token) return;

    const headers = { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" };
    const docksRes = await axios.get("https://api.aryankaushik.space/api/docks/my", { headers });
    const dockId = docksRes.data[0]?._id || docksRes.data[0]?.id || docksRes.data.docks?.[0]?._id;

    console.log("Testing pagination on dock:", dockId);

    // Fetch page 1
    const p1 = await axios.get(`https://api.aryankaushik.space/api/docks/${dockId}/messages?limit=10`, { headers });
    const p1Msgs = p1.data.messages || p1.data || [];
    console.log("Page 1 first msg ID:", p1Msgs[0]?._id, "date:", p1Msgs[0]?.createdAt);
    console.log("Page 1 last msg ID:", p1Msgs[p1Msgs.length-1]?._id, "date:", p1Msgs[p1Msgs.length-1]?.createdAt);

    // Try offset=10
    const p2Offset = await axios.get(`https://api.aryankaushik.space/api/docks/${dockId}/messages?limit=10&offset=10`, { headers });
    const p2OffsetMsgs = p2Offset.data.messages || p2Offset.data || [];
    console.log("\nWith offset=10 first msg ID:", p2OffsetMsgs[0]?._id, "date:", p2OffsetMsgs[0]?.createdAt);

    // Try page=2
    const p2Page = await axios.get(`https://api.aryankaushik.space/api/docks/${dockId}/messages?limit=10&page=2`, { headers });
    const p2PageMsgs = p2Page.data.messages || p2Page.data || [];
    console.log("\nWith page=2 first msg ID:", p2PageMsgs[0]?._id, "date:", p2PageMsgs[0]?.createdAt);

    // Try before=p1Msgs[0]._id
    if (p1Msgs.length > 0) {
      const p2Before = await axios.get(`https://api.aryankaushik.space/api/docks/${dockId}/messages?limit=10&before=${p1Msgs[0]._id}`, { headers });
      const p2BeforeMsgs = p2Before.data.messages || p2Before.data || [];
      console.log("\nWith before=(first msg ID) first msg ID:", p2BeforeMsgs[0]?._id, "date:", p2BeforeMsgs[0]?.createdAt);
    }
  } catch (e) {
    console.error(e.message);
  }
}

run();
