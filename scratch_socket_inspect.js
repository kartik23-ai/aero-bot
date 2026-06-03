const { io } = require("socket.io-client");
const axios = require("axios");

const SOCKET_BASE = "https://api.aryankaushik.space";

async function run() {
  try {
    const statusRes = await axios.get("http://localhost:8080/api/install/status");
    const token = statusRes.data.accessToken;
    console.log("Token:", token ? "FOUND" : "NOT FOUND");

    if (!token) return;

    console.log("Connecting socket to:", SOCKET_BASE);
    const socket = io(SOCKET_BASE, {
      auth: { token },
      transports: ["websocket", "polling"]
    });

    socket.on("connect", () => {
      console.log("Socket connected! ID:", socket.id);
    });

    socket.onAny((event, ...args) => {
      console.log(`[SOCKET EVENT] ${event}:`, JSON.stringify(args, null, 2));
    });

    socket.on("disconnect", (reason) => {
      console.log("Socket disconnected:", reason);
    });

    socket.on("connect_error", (err) => {
      console.error("Socket connection error:", err.message);
    });

    // Let the script run for 60 seconds to capture events
    setTimeout(() => {
      console.log("Stopping inspect script.");
      socket.disconnect();
      process.exit(0);
    }, 60000);

  } catch (err) {
    console.error(err.message);
  }
}

run();
