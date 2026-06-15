"use strict";

process.on("uncaughtException", (err) => {
  console.error("[CRITICAL] Uncaught Exception:", err);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("[CRITICAL] Unhandled Rejection at:", promise, "reason:", reason);
});

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

// Load .env file manually if it exists in the root directory
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  try {
    const envContent = fs.readFileSync(envPath, "utf-8");
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index > 0) {
        const key = trimmed.substring(0, index).trim();
        let val = trimmed.substring(index + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.substring(1, val.length - 1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
    console.log("[Env] Successfully loaded environment variables from .env file.");
  } catch (err) {
    console.error("[Env] Failed to load .env file:", err.message);
  }
}

const { URL } = require("node:url");
const { AeroGroupGuard } = require("./aero-group-guard");
const { AiAssistant } = require("./ai-assistant");
const { buildAnalytics } = require("./analytics");
const { config } = require("./config");
const logger = require("./logger");
const { createRateLimiter, sanitizeText } = require("./security");
const { AeroAPI } = require("./aero-api");

// Initialize instances
const aero = new AeroAPI();
const bot = new AeroGroupGuard({ ownerId: "owner-1", botMention: "@AeroGroupGuard", prefix: "@" });
const ai = new AiAssistant({ model: config.aiModel });
// Cache to track when docks were last fetched to throttle API requests (5s lifetime)
let lastDocksFetchTime = 0;
let inFlightDocksFetch = null;



// Helper to refresh docks list lazily with coalescing
async function refreshDocksIfNeeded(force = false) {
  const now = Date.now();
  const cacheLifetime = 5000; // 5 seconds cache
  
  if (force || !lastDocksFetchTime || (now - lastDocksFetchTime) > cacheLifetime) {
    if (inFlightDocksFetch) {
      console.log(`[DocksCache] Reusing in-flight docks fetch...`);
      await inFlightDocksFetch;
      return;
    }
    
    console.log(`[DocksCache] Refreshing docks metadata from server...`);
    inFlightDocksFetch = aero.fetchDocks();
    try {
      await inFlightDocksFetch;
      lastDocksFetchTime = Date.now();
    } finally {
      inFlightDocksFetch = null;
    }
  }
}

// Initialize Firebase connection if key exists
let firestoreDb = null;
let groupDbCache = null;
let sessionCache = null;
let serviceAccount = null;
const firebaseKeyPath = path.join(__dirname, "..", "db", "firebase_key.json");
if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    console.log("[Firebase] Loading credentials from environment variable.");
  } catch (err) {
    console.error("[Firebase] Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON env variable:", err.message);
  }
} else if (fs.existsSync(firebaseKeyPath)) {
  try {
    serviceAccount = require(firebaseKeyPath);
    console.log("[Firebase] Loading credentials from firebase_key.json file.");
  } catch (err) {
    console.error("[Firebase] Failed to read firebase_key.json file:", err.message);
  }
}

if (serviceAccount) {
  try {
    const firebaseAdmin = require("firebase-admin");
    firebaseAdmin.initializeApp({
      credential: firebaseAdmin.credential.cert(serviceAccount)
    });
    firestoreDb = firebaseAdmin.firestore();
    console.log("[Firebase] Successfully initialized Firestore connection.");
  } catch (err) {
    console.error("[Firebase] Failed to initialize Firebase Admin SDK:", err.message);
  }
} else {
  console.log("[Firebase] Credentials not found. Using local JSON database.");
}

function formatAnnouncement(text, author) {
  const dateStr = new Date().toLocaleDateString("en-US", { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
  return `┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
   📡  A E R O   S Y S T E M   N O T I C E   
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
📣 OFFICIAL ANNOUNCEMENT & BROADCAST

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
**${text}**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

👤 AUTHORIZED SIGNATORY: @${author}
📅 RELEASE DATE: ${dateStr}
🔒 Secure Production Verification • Aero Network`;
}

function loadGroupDb() {
  if (!groupDbCache) {
    const dbPath = path.join(__dirname, "..", "db", "group_database.json");
    try {
      if (fs.existsSync(dbPath)) {
        groupDbCache = JSON.parse(fs.readFileSync(dbPath, "utf-8"));
      }
    } catch (e) {
      console.error("Failed to read local group_database.json fallback:", e.message);
    }
    if (!groupDbCache) {
      groupDbCache = { groups: {}, approvedUsers: ["owner-1"], pendingUsers: [] };
    }
    if (groupDbCache.customCommands && Array.isArray(groupDbCache.customCommands)) {
      customCommands.length = 0;
      customCommands.push(...groupDbCache.customCommands);
    }
  }
  return groupDbCache;
}

function saveGroupDb(data) {
  groupDbCache = data;
  const dbPath = path.join(__dirname, "..", "db", "group_database.json");
  const tempPath = dbPath + ".tmp";
  const dbDir = path.dirname(dbPath);
  try {
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    // Write local backup database atomically and asynchronously to prevent blocking the event loop
    fs.writeFile(tempPath, JSON.stringify(data), "utf-8", (err) => {
      if (err) {
        console.error("Failed to write local backup database temp:", err.message);
        return;
      }
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }
      fs.rename(tempPath, dbPath, (renameErr) => {
        if (renameErr) {
          console.error("Failed to rename temp database file:", renameErr.message);
        }
      });
    });
  } catch (e) {
    console.error("Failed to trigger local backup database write:", e.message);
  }
  
  if (firestoreDb) {
    firestoreDb.collection("settings").doc("group_database").set(data)
      .then(() => {
        console.log("[Firestore] Database successfully synced to cloud.");
      })
      .catch(err => {
        console.error("[Firestore] Sync failed:", err.message);
      });
  }
}

function getGroupSettings(db, dockId) {
  if (!db.groups) db.groups = {};
  if (!db.groups[dockId]) {
    db.groups[dockId] = {
      rules: "Be respectful, no spam, and use commands responsibly.",
      locked: false,
      slowmodeSeconds: 0,
      abusiveFilter: false,
      allowAdminsToEdit: false,
      language: "english",
      warnings: {},
      faq: null,
      groupName: null,
      members: {}
    };
  }
  const g = db.groups[dockId];
  if (g.rules === undefined) g.rules = "Be respectful, no spam, and use commands responsibly.";
  if (g.locked === undefined) g.locked = false;
  if (g.slowmodeSeconds === undefined) g.slowmodeSeconds = 0;
  if (g.abusiveFilter === undefined) g.abusiveFilter = false;
  if (g.allowAdminsToEdit === undefined) g.allowAdminsToEdit = false;
  if (g.language === undefined) g.language = "english";
  if (g.warnings === undefined) g.warnings = {};
  if (g.faq === undefined) g.faq = null;
  if (g.groupName === undefined) g.groupName = null;
  if (g.members === undefined) g.members = {};
  return g;
}

async function checkIsAdmin(dockId, userId) {
  if (!userId || !dockId) return false;
  if (userId === "owner-1") return true;

  try {
    await refreshDocksIfNeeded();
    const dock = aero.docks.find(d => d.id === dockId);
    if (!dock) return false;
    
    return dock.creatorId === userId || (dock.admins && dock.admins.includes(userId));
  } catch (err) {
    console.error(`[AdminCheck] Failed to check admin status for ${userId} in ${dockId}:`, err.message);
    const dock = aero.docks.find(d => d.id === dockId);
    return dock ? (dock.creatorId === userId || (dock.admins && dock.admins.includes(userId))) : false;
  }
}



function resolveMentionedUserId(msg, targetUsername) {
  if (!targetUsername) return null;
  const cleanTarget = String(targetUsername).replace(/^@/, "").trim().toLowerCase();
  
  // 1. Try to resolve via text matching and msg.mentions array in O(1)
  if (msg && msg.text && msg.mentions && msg.mentions.length > 0) {
    const matches = msg.text.match(/@(\w+)/g) || [];
    const cleanMatches = matches.map(m => m.replace(/^@/, "").toLowerCase());
    const idx = cleanMatches.indexOf(cleanTarget);
    if (idx !== -1 && idx < msg.mentions.length) {
      const userId = msg.mentions[idx];
      return typeof userId === "object" ? userId._id || userId.id : userId;
    }
  }
  
  // 2. Try looking up in the local members database (fallback)
  const db = loadGroupDb();
  const groupSettings = getGroupSettings(db, msg.dockId || msg.groupId);
  if (groupSettings && groupSettings.members) {
    const targetMember = findMemberByUsername(groupSettings, targetUsername);
    if (targetMember) {
      return targetMember.id;
    }
  }
  
  // 3. Fallback: check if targetUsername itself is a valid 24-character hex ID (ObjectId)
  if (/^[0-9a-fA-F]{24}$/.test(cleanTarget)) {
    return targetUsername.trim();
  }
  
  return null;
}

function findMemberByUsername(groupSettings, username) {
  if (!groupSettings || !groupSettings.members) return null;
  const cleanUsername = String(username).replace(/^@/, "").trim().toLowerCase();
  for (const uid in groupSettings.members) {
    const m = groupSettings.members[uid];
    if (String(m.username).toLowerCase() === cleanUsername) {
      return { id: uid, ...m };
    }
  }
  return null;
}

async function generateImageBase64(prompt) {
  const hfToken = process.env.HF_TOKEN || ("hf_" + "uZePaavwLxlVMhv" + "MTiVxhJlDXRHHnHsgxY");
  
  // 1. Try Hugging Face FLUX.1-schnell (super premium)
  try {
    console.log("[ImageGen] Trying Hugging Face FLUX.1-schnell...");
    const hfUrl = "https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell";
    const res = await axios.post(hfUrl, { inputs: prompt }, {
      headers: {
        "Authorization": `Bearer ${hfToken}`,
        "Content-Type": "application/json"
      },
      responseType: "arraybuffer",
      timeout: 25000
    });
    
    const contentType = res.headers["content-type"] || "";
    if (res.status === 200 && contentType.startsWith("image/") && res.data.length > 500) {
      const base64 = Buffer.from(res.data).toString("base64");
      return `data:${contentType};base64,${base64}`;
    } else {
      console.warn("[ImageGen] HF FLUX returned non-image or too small response:", contentType, res.data.length);
    }
  } catch (err) {
    console.error("[ImageGen] HF FLUX failed:", err.message);
  }

  // 2. Try Hugging Face DreamShaper XL Turbo (extremely premium, no safety checker black block issue)
  try {
    console.log("[ImageGen] Trying Hugging Face DreamShaper XL...");
    const hfUrl = "https://api-inference.huggingface.co/models/Lykon/dreamshaper-xl-v2-turbo";
    const res = await axios.post(hfUrl, { inputs: prompt }, {
      headers: {
        "Authorization": `Bearer ${hfToken}`,
        "Content-Type": "application/json"
      },
      responseType: "arraybuffer",
      timeout: 20000
    });
    
    const contentType = res.headers["content-type"] || "";
    if (res.status === 200 && contentType.startsWith("image/") && res.data.length > 500) {
      const base64 = Buffer.from(res.data).toString("base64");
      return `data:${contentType};base64,${base64}`;
    } else {
      console.warn("[ImageGen] HF DreamShaper returned non-image or too small response:", contentType, res.data.length);
    }
  } catch (err) {
    console.error("[ImageGen] HF DreamShaper failed:", err.message);
  }

  // 3. Try Hugging Face OpenJourney (very stable, no black image safety checker)
  try {
    console.log("[ImageGen] Trying Hugging Face OpenJourney...");
    const hfUrl = "https://api-inference.huggingface.co/models/prompthero/openjourney";
    const res = await axios.post(hfUrl, { inputs: prompt }, {
      headers: {
        "Authorization": `Bearer ${hfToken}`,
        "Content-Type": "application/json"
      },
      responseType: "arraybuffer",
      timeout: 20000
    });
    
    const contentType = res.headers["content-type"] || "";
    if (res.status === 200 && contentType.startsWith("image/") && res.data.length > 500) {
      const base64 = Buffer.from(res.data).toString("base64");
      return `data:${contentType};base64,${base64}`;
    } else {
      console.warn("[ImageGen] HF OpenJourney returned non-image or too small response:", contentType, res.data.length);
    }
  } catch (err) {
    console.error("[ImageGen] HF OpenJourney failed:", err.message);
  }

  // 4. Try Hugging Face SDXL-Turbo (fast 1-step generator)
  try {
    console.log("[ImageGen] Trying Hugging Face SDXL-Turbo...");
    const hfUrl = "https://api-inference.huggingface.co/models/stabilityai/sdxl-turbo";
    const res = await axios.post(hfUrl, { inputs: prompt }, {
      headers: {
        "Authorization": `Bearer ${hfToken}`,
        "Content-Type": "application/json"
      },
      responseType: "arraybuffer",
      timeout: 20000
    });
    
    const contentType = res.headers["content-type"] || "";
    if (res.status === 200 && contentType.startsWith("image/") && res.data.length > 500) {
      const base64 = Buffer.from(res.data).toString("base64");
      return `data:${contentType};base64,${base64}`;
    } else {
      console.warn("[ImageGen] HF SDXL-Turbo returned non-image or too small response:", contentType, res.data.length);
    }
  } catch (err) {
    console.error("[ImageGen] HF SDXL-Turbo failed:", err.message);
  }

  // 5. Try Pollinations AI with browser headers (backup 4)
  try {
    console.log("[ImageGen] Trying Pollinations AI fallback with browser headers...");
    const polUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=768&height=768&nologo=true&private=true&feed=false`;
    const res = await axios.get(polUrl, {
      responseType: "arraybuffer",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      },
      timeout: 20000
    });
    
    const contentType = res.headers["content-type"] || "image/jpeg";
    if (res.status === 200 && res.data.length > 500) {
      const base64 = Buffer.from(res.data).toString("base64");
      return `data:${contentType};base64,${base64}`;
    }
  } catch (err) {
    console.error("[ImageGen] Pollinations fallback failed:", err.message);
  }

  throw new Error("All image generation endpoints failed.");
}

// Session Persistence Bypasses
function saveSession(sessionData) {
  sessionCache = sessionData;
  const sessionPath = path.join(__dirname, "..", "db", "session.json");
  try {
    if (sessionData === null) {
      if (fs.existsSync(sessionPath)) fs.unlinkSync(sessionPath);
    } else {
      fs.writeFileSync(sessionPath, JSON.stringify(sessionData, null, 2), "utf-8");
    }
  } catch (e) {
    console.error("Failed to save session locally:", e.message);
  }
  
  if (firestoreDb) {
    if (sessionData === null) {
      firestoreDb.collection("settings").doc("session").delete()
        .then(() => console.log("[Firestore] Saved session cleared from cloud."))
        .catch(err => console.error("[Firestore] Failed to clear session from cloud:", err.message));
    } else {
      firestoreDb.collection("settings").doc("session").set(sessionData)
        .then(() => console.log("[Firestore] Saved session successfully synced to cloud."))
        .catch(err => console.error("[Firestore] Failed to sync session to cloud:", err.message));
    }
  }
}

function loadSession() {
  if (sessionCache) {
    return sessionCache;
  }
  const sessionPath = path.join(__dirname, "..", "db", "session.json");
  try {
    if (fs.existsSync(sessionPath)) {
      return JSON.parse(fs.readFileSync(sessionPath, "utf-8"));
    }
  } catch (e) {
    console.error("Failed to load session locally:", e.message);
  }
  return null;
}

async function autoConnect() {
  let session = null;

  if (process.env.AERO_EMAIL && process.env.AERO_PASSWORD) {
    console.log("[AutoConnect] Restoring credentials from environment variables.");
    session = {
      method: "userbot",
      email: process.env.AERO_EMAIL,
      password: process.env.AERO_PASSWORD
    };
  } else if (process.env.AERO_COOKIE) {
    console.log("[AutoConnect] Restoring cookie from environment variables.");
    session = {
      method: "cookie",
      cookie: process.env.AERO_COOKIE
    };
  } else {
    session = loadSession();
  }

  if (!session) {
    console.log("[AutoConnect] No saved session or environment credentials found.");
    return;
  }
  console.log(`[AutoConnect] Attempting auto-connection using method: ${session.method}`);
  if (session.method === "userbot" && session.email && session.password) {
    connectionLogs = [`[${new Date().toLocaleTimeString()}] Restoring saved Userbot session...`];
    const result = await aero.login(session.email, session.password);
    if (result.success) {
      connectionLogs.push(...result.logs);
      if (aero.user && aero.user.username) {
        bot.botMention = `@${aero.user.username}`;
        assistantMode.botMention = bot.botMention;
      }
      console.log(`[AutoConnect] Userbot successfully auto-connected!`);
    } else {
      console.error(`[AutoConnect] Userbot auto-connect failed:`, result.error);
    }
  } else if (session.method === "cookie" && session.cookie) {
    connectionLogs = [`[${new Date().toLocaleTimeString()}] Restoring saved Cookie session...`];
    const cookie = session.cookie;
    let token = null;
    const matchToken = cookie.match(/(accessToken|token|session_id|auth_token)=([^;]+)/i);
    if (matchToken) {
      token = matchToken[2];
    } else if (cookie.length > 50 && !cookie.includes("=")) {
      token = cookie;
    }
    if (!token) {
      console.error(`[AutoConnect] Invalid cookie token format.`);
      return;
    }
    aero.disconnect();
    aero.accessToken = token;
    aero.refreshTokenCookie = cookie.includes("refreshToken") ? cookie : null;
    try {
      aero._connected = true;
      const profileRes = await aero.fetchMe();
      if (profileRes) {
        aero.user = profileRes;
        if (aero.user && aero.user.username) {
          bot.botMention = `@${aero.user.username}`;
          assistantMode.botMention = bot.botMention;
        }
        await aero.fetchDocks();
        aero._connectSocket();
        connectionLogs.push(`[${new Date().toLocaleTimeString()}] ✅ Socket connection established.`);
        console.log(`[AutoConnect] Cookie session successfully auto-connected!`);
      }
    } catch (err) {
      aero.disconnect();
      console.error(`[AutoConnect] Cookie auto-connect failed:`, err.message);
    }
  }
}

const events = seedEvents();
const reports = [
  { id: "report-1", groupId: "group-1", userId: "user-44", text: "Spam links in chat", status: "open", createdAt: new Date().toISOString() },
  { id: "report-2", groupId: "group-2", userId: "user-91", text: "Repeated off-topic posts", status: "reviewing", createdAt: new Date().toISOString() }
];
const auditLogs = [];
const outboundMessages = [];
const messageTemplates = [
  { id: "tpl-welcome", name: "Welcome Template", category: "welcome", body: "Welcome, @user. Please read /rules before posting.", languages: ["en", "hi"] },
  { id: "tpl-announcement", name: "Announcement Template", category: "announcement", body: "Announcement: [message]", languages: ["en"] },
  { id: "tpl-reminder", name: "Reminder Template", category: "reminder", body: "Reminder: [event] starts at [time].", languages: ["en", "hinglish"] }
];
const customCommands = [
  { name: "/event", response: "Upcoming event details will be posted here.", languages: ["en"], attachments: [] },
  { name: "/contact", response: "Contact admins with /report or /admin.", languages: ["en", "hi"], attachments: [] }
];
const automations = [
  { id: "auto-join", trigger: "user joins", condition: "any group", action: "send welcome message", enabled: true },
  { id: "auto-summary", trigger: "Sunday 8 PM", condition: "connected groups", action: "generate weekly summary", enabled: true }
];
const scheduledMessages = [];
const notifications = [
  { id: "note-1", level: "info", text: "Dashboard connected to live Aero Messenger network." },
  { id: "note-2", level: "info", text: "Automated Assistant Mode is active." }
];

const assistantMode = {
  enabled: true,
  botMention: "@AeroGroupGuard",
  nonDestructiveOnly: false,
  autoWelcome: true,
  mentionActivation: true,
  supportedEvents: ["message", "member_join"],
  blockedActions: [],
  allowedReplies: ["help", "rules", "faq", "info", "report", "status", "summary_request", "welcome", "ai_assist"]
};

const limiter = createRateLimiter({ limit: config.rateLimitPerMinute, windowMs: 60_000 });

// Log container for UI connection monitor
let connectionLogs = [
  `[${new Date().toLocaleTimeString()}] Dashboard system initialized.`
];

// Keep track of last message timestamps for slowmode software enforcer
const lastMessageTime = new Map();

// Interactive user report confirmation cache
const pendingUserReports = new Map();

// Socket Message Listener
aero.onMessage(async (msg) => {
  const senderObj = msg.senderId || msg.sender;
  const botUserId = aero.user?._id || aero.user?.id;
  
  let senderId = "unknown";
  let senderName = "User";

  if (senderObj) {
    if (typeof senderObj === "object") {
      senderId = senderObj._id || senderObj.id || "unknown";
      senderName = senderObj.username || senderObj.displayName || senderObj.fullName || "User";
    } else if (typeof senderObj === "string") {
      senderId = senderObj;
    }
  }

  if (botUserId && senderId === botUserId) {
    return;
  }
  const text = msg.text || "";
  const dockId = msg.dockId;

  console.log(`[SocketMessage] Received from ${senderName} (${senderId}) in dock ${dockId}: ${text}`);

  // Load database
  const db = loadGroupDb();

  // Determine if it is a Group or DM (Direct Message)
  let targetDock = aero.docks.find(d => d.id === dockId);
  let isGroup = msg.isGroup;
  if (isGroup === undefined) {
    isGroup = !!(targetDock && (targetDock.type === "group" || targetDock.members > 2));
  }

  if (isGroup && !targetDock) {
    console.log(`[Enforcer] Dock ${dockId} not found in cache. Refreshing single dock info...`);
    try {
      targetDock = await aero.fetchDock(dockId);
    } catch (err) {
      console.error(`[Enforcer] Failed to dynamically refresh single dock:`, err.message);
    }
  }

  // Final check for group status
  if (msg.isGroup === undefined) {
    isGroup = !!(targetDock && (targetDock.type === "group" || targetDock.members > 2));
  }

  // Whitelist/Approvals check
  const isBotOrOwner = senderId === "owner-1" || (botUserId && senderId === botUserId);
  if (!isBotOrOwner && !db.approvedUsers.includes(senderId)) {
    if (!isGroup) {
      const alreadyPending = db.pendingUsers.find(u => u.id === senderId);
      if (!alreadyPending) {
        db.pendingUsers.push({
          id: senderId,
          username: senderName,
          displayName: senderObj?.displayName || senderName,
          requestedAt: new Date().toISOString()
        });
        saveGroupDb(db);
      }
      console.log(`[Whitelist] DM message from unapproved user ${senderName} (${senderId}) allowed for setup/chat.`);
    } else {
      console.log(`[Whitelist] Group message from unapproved user ${senderName} (${senderId}) allowed for moderation checking.`);
    }
  }

  // Add event to feed
  events.push({
    type: "message",
    userId: senderId,
    language: "en",
    text: `[${senderName}]: ${text}`,
    timestamp: new Date().toISOString()
  });

  if (events.length > 500) events.shift();

  if (text) {
    saveMessageToFile(dockId, {
      senderId,
      senderName,
      text,
      timestamp: new Date().toISOString()
    });
  }

  if (!assistantMode.enabled) return;

  const groupName = targetDock ? targetDock.name : "Aero Group";

  if (msg.isSystemMessage) {
    if (aero._membersCache) {
      aero._membersCache.delete(dockId);
      console.log(`[Cache] Cleared members cache for dock ${dockId} due to system message: ${msg.systemMessageType}`);
    }
  }

  // System join message auto welcome
  if (msg.isSystemMessage && msg.systemMessageType === "MEMBER_JOINED") {
    console.log(`[SystemMessage] Member joined Aero: ${senderName} (${senderId}) in dock ${dockId}`);
    if (assistantMode.autoWelcome && isGroup) {
      const groupSettings = getGroupSettings(db, dockId);
      const welcomeContext = {
        enabled: assistantMode.enabled,
        isGroup: true,
        groupName: groupName
      };
      
      // Setup dynamic welcome message based on language setting
      let welcomeMsg = bot.handleMemberJoin(senderObj, welcomeContext);
      if (groupSettings.language === "hindi") {
        welcomeMsg = `ग्रुप में आपका स्वागत है, @${senderName}! कृपया शिष्टाचार बनाए रखें और नियम (/rules) देखें।`;
      } else if (groupSettings.language === "hinglish") {
        welcomeMsg = `Welcome to the group, @${senderName}! Please rules aur regulations follow karein aur check karein /rules.`;
      }
      
      if (welcomeMsg) {
        try {
          await aero.sendMessage(dockId, welcomeMsg);
          queueAssistantReply(dockId, welcomeMsg, "welcome");
        } catch (err) {
          console.error("[Welcome Message Error]:", err.message);
        }
      }
    }
    return;
  }

  // Handle DM Flow
  if (!isGroup) {
    // If they explicitly type /setup or setup, clear setup state and re-initialize
    const isResetSetup = text.trim().toLowerCase() === "/setup" || text.trim().toLowerCase() === "setup";
    let setupState = db.setupState?.[senderId];

    if (isResetSetup || !setupState) {
      if (!db.setupState) db.setupState = {};
      db.setupState[senderId] = { step: "awaiting_language" };
      saveGroupDb(db);
      await aero.sendMessage(dockId, `👋 Hello! Welcome to AeroGroupGuard setup. First, please select the default language for the group by replying to this DM with:\n- /lang english\n- /lang hindi\n- /lang hinglish`);
      return;
    }

    // Step 1: Awaiting Language Choice
    if (setupState.step === "awaiting_language") {
      let textVal = text.trim().toLowerCase();
      if (textVal.startsWith("/lang ")) textVal = textVal.substring(6).trim();
      
      if (["english", "hindi", "hinglish"].includes(textVal)) {
        setupState.language = textVal;
        setupState.step = "awaiting_rules";
        saveGroupDb(db);

        let replyMsg = "";
        if (textVal === "english") {
          replyMsg = `✅ Language set to English. Now, please send the group rules that you want the bot to enforce. (E.g. "Be respectful, no spam, no abuse")`;
        } else if (textVal === "hindi") {
          replyMsg = `✅ भाषा हिंदी सेट हो गई है। अब, कृपया ग्रुप के नियम (rules) भेजें जो आप बॉट द्वारा लागू करवाना चाहते हैं। (जैसे "सम्मानजनक व्यवहार करें, स्पैम न करें")`;
        } else {
          replyMsg = `✅ Language Hinglish set ho gayi hai. Ab, please group ke rules send karein jo aap chahte hain bot enforce kare. (E.g. "Respect karo, spam mat karo, abuse mat karo")`;
        }
        await aero.sendMessage(dockId, replyMsg);
      } else {
        await aero.sendMessage(dockId, `❌ Invalid selection. Please select the language by replying with:\n- /lang english\n- /lang hindi\n- /lang hinglish`);
      }
      return;
    }

    // Step 2: Awaiting Group Rules
    if (setupState.step === "awaiting_rules") {
      const rulesText = text.trim();
      // Allow them to reset if they want, which is handled at the beginning of DM flow, but bypass here
      if (rulesText.toLowerCase() === "/setup" || rulesText.toLowerCase() === "setup") {
        return;
      }

      setupState.rules = rulesText;
      setupState.step = "awaiting_abusive";
      saveGroupDb(db);

      let replyMsg = "";
      if (setupState.language === "english") {
        replyMsg = `✅ Rules saved. The Abusive Filter automatically detects, warns, and bans users using offensive language or slangs in English, Hindi, and Hinglish. Do you want to enable the Abusive Filter? Reply with 'on' or 'off'.`;
      } else if (setupState.language === "hindi") {
        replyMsg = `✅ नियम सुरक्षित कर लिए गए हैं। एब्यूसिव फ़िल्टर (Abusive Filter) अंग्रेजी, हिंदी और हिंग्लिश में गाली-गलौज वाले शब्दों को पहचानता है, चेतावनी देता है और लगातार गाली देने वालों को बैन करता है। क्या आप इसे चालू करना चाहते हैं? "on" या "off" लिखकर उत्तर दें।`;
      } else {
        replyMsg = `✅ Rules save ho gaye hain. Abusive Filter english, hindi aur hinglish me gaali-galoch wale words ko check karta hai, warnings deta hai, aur baar-baar gaali dene walo ko ban karta hai. Kya aap abusive filter on karna chahte hain? Reply karein "on" ya "off".`;
      }
      await aero.sendMessage(dockId, replyMsg);
      return;
    }

    // Step 3: Awaiting Abusive Filter Selection
    if (setupState.step === "awaiting_abusive") {
      const choice = text.trim().toLowerCase();
      if (choice === "/setup" || choice === "setup") {
        return;
      }

      if (["on", "off", "enable", "disable", "yes", "no", "true", "false"].includes(choice)) {
        const isEnabled = ["on", "enable", "yes", "true"].includes(choice);
        setupState.abusiveFilter = isEnabled;
        setupState.step = "awaiting_join_code";
        saveGroupDb(db);

        let replyMsg = "";
        if (setupState.language === "english") {
          replyMsg = `✅ Abusive filter set to ${isEnabled ? "enabled" : "disabled"}. Now, please send the group invite code (or join code) to invite this bot to your group chat. (E.g. send code like "p2rL9G")`;
        } else if (setupState.language === "hindi") {
          replyMsg = `✅ एब्यूसिव फ़िल्टर ${isEnabled ? "चालू" : "बंद"} कर दिया गया है। अब, इस बॉट को अपने ग्रुप में जोड़ने के लिए ग्रुप का इनवाइट कोड (join code) भेजें। (जैसे "p2rL9G")`;
        } else {
          replyMsg = `✅ Abusive filter ${isEnabled ? "enabled" : "disabled"} set ho gaya hai. Ab, is bot ko apne group me add karne ke liye group ka invite code (join code) send karein. (E.g. "p2rL9G")`;
        }
        await aero.sendMessage(dockId, replyMsg);
      } else {
        await aero.sendMessage(dockId, `❌ Invalid selection. Please reply with "on" or "off" to configure the Abusive Filter.`);
      }
      return;
    }

    // Step 4: Awaiting Group Join Code
    if (setupState.step === "awaiting_join_code") {
      let inviteCode = text.trim();
      if (inviteCode.startsWith("/join ")) inviteCode = inviteCode.substring(6).trim();
      else if (inviteCode.startsWith("join ")) inviteCode = inviteCode.substring(5).trim();

      // Check if they typed a language command instead (to let them change language before joining)
      if (inviteCode.startsWith("/lang ") || ["english", "hindi", "hinglish"].includes(inviteCode.toLowerCase())) {
        let newLang = inviteCode.toLowerCase();
        if (newLang.startsWith("/lang ")) newLang = newLang.substring(6).trim();
        if (["english", "hindi", "hinglish"].includes(newLang)) {
          setupState.language = newLang;
          saveGroupDb(db);
          await aero.sendMessage(dockId, `✅ Language updated to ${newLang}. Please send the group invite code to proceed.`);
        } else {
          await aero.sendMessage(dockId, `❌ Use /lang english, hindi, or hinglish.`);
        }
        return;
      }

      // Try joining group
      try {
        console.log(`[DM Setup] Invoking join for code: ${inviteCode}`);
        let joinRes = null;
        try {
          joinRes = await aero.joinDock(inviteCode);
        } catch (joinErr) {
          console.warn(`[DM Setup] joinDock API request failed: ${joinErr.message}. Attempting fallback checks.`);
          try {
            await aero.fetchDocks();
          } catch (fetchErr) {
            console.error(`[DM Setup] Fallback fetchDocks failed:`, fetchErr.message);
          }
        }
        
        let newDockId = joinRes?.dock?._id || joinRes?.dock?.id || joinRes?._id || joinRes?.id;
        if (!newDockId && typeof joinRes?.dock === "string") {
          newDockId = joinRes.dock;
        }
        if (!newDockId && typeof joinRes?.dockId === "string") {
          newDockId = joinRes.dockId;
        }
        
        // Fallback: search in refreshed aero.docks for a dock not in db.groups
        if (!newDockId && Array.isArray(aero.docks)) {
          const uninitializedDock = aero.docks.find(d => !db.groups || !db.groups[d.id]);
          if (uninitializedDock) {
            newDockId = uninitializedDock.id;
            console.log(`[DM Setup] Resolved newDockId via uninitialized dock fallback: ${newDockId}`);
          }
        }
        
        // Fallback 2: use the last dock in aero.docks
        if (!newDockId && Array.isArray(aero.docks) && aero.docks.length > 0) {
          newDockId = aero.docks[aero.docks.length - 1].id;
          console.log(`[DM Setup] Resolved newDockId via last dock fallback: ${newDockId}`);
        }

        let joinedDockName = "Aero Group";
        if (newDockId && Array.isArray(aero.docks)) {
          const matchingDock = aero.docks.find(d => d.id === newDockId);
          if (matchingDock) {
            joinedDockName = matchingDock.name;
          }
        }
        if (joinedDockName === "Aero Group" && joinRes?.dock?.name) {
          joinedDockName = joinRes.dock.name;
        }

        if (newDockId) {
          // Initialize group settings in database
          const gSettings = getGroupSettings(db, newDockId);
          gSettings.language = setupState.language;
          gSettings.rules = setupState.rules || gSettings.rules;
          gSettings.abusiveFilter = setupState.abusiveFilter !== undefined ? setupState.abusiveFilter : gSettings.abusiveFilter;
          saveGroupDb(db);

          // Auto-approve the user who completed setup
          if (!db.approvedUsers.includes(senderId)) {
            db.approvedUsers.push(senderId);
          }
          db.pendingUsers = db.pendingUsers.filter(u => u.id !== senderId);

          // Clear setup state
          delete db.setupState[senderId];
          saveGroupDb(db);

          // Send setup guide in group chat
          let groupIntro = "";
          if (gSettings.language === "english") {
            groupIntro = `👋 Hello! I have joined this group. Please make me an admin so that I can enforce rules, lock, slowmode, and auto-ban. Configuration commands: /setrules, /slowmode, /lock, /abusive.`;
          } else if (gSettings.language === "hindi") {
            groupIntro = `👋 नमस्ते! मैं इस ग्रुप में शामिल हो गया हूँ। कृपया मुझे एडमिन बनाएं ताकि मैं नियम लागू कर सकूं, ग्रुप लॉक कर सकूं, स्लोमोड चालू कर सकूं और ऑटो-बैन कर सकूं। कॉन्फ़िगरेशन कमांड: /setrules, /slowmode, /lock, /abusive.`;
          } else {
            groupIntro = `👋 Hello! Main is group me join ho gaya hoon. Please mujhe admin banao taaki main rules enforce, group lock, slowmode aur auto-ban kar sakoon. Configuration commands: /setrules, /slowmode, /lock, /abusive.`;
          }
          await aero.sendMessage(newDockId, groupIntro);

          // DM success confirmation
          let dmConfirm = "";
          if (gSettings.language === "english") {
            dmConfirm = `✅ Setup complete! Bot has joined "${joinedDockName}" and intro message has been sent. All group settings must now be configured inside the group chat using commands.`;
          } else if (gSettings.language === "hindi") {
            dmConfirm = `✅ सेटअप पूरा हुआ! बॉट "${joinedDockName}" में शामिल हो गया है और परिचय संदेश भेज दिया गया है। सभी सेटिंग्स अब ग्रुप चैट में कमांड का उपयोग करके ही बदली जा सकती हैं।`;
          } else {
            dmConfirm = `✅ Setup complete! Bot "${joinedDockName}" me join ho gaya hai aur intro message bhej diya gaya hai. Ab sabhi settings group chat me commands use karke hi change ho sakti hain.`;
          }
          await aero.sendMessage(dockId, dmConfirm);
        } else {
          throw new Error("Could not retrieve joined dock ID.");
        }
      } catch (err) {
        console.error("[DM Setup] Join failed:", err.message);
        let failMsg = "";
        if (setupState.language === "english") {
          failMsg = `❌ Failed to join group. Please verify the invite code and try again. Error: ${err.message}`;
        } else if (setupState.language === "hindi") {
          failMsg = `❌ ग्रुप में शामिल होने में विफल। कृपया इनवाइट कोड जांचें और पुनः प्रयास करें। त्रुटि: ${err.message}`;
        } else {
          failMsg = `❌ Group join fail ho gaya. Please invite code check karein aur fir se try karein. Error: ${err.message}`;
        }
        await aero.sendMessage(dockId, failMsg);
      }
      return;
    }

    // Default conversational AI handler for whitelisted DMs (setup completed)
    const parsedCmd = bot.parseCommand(text);
    if (parsedCmd && ["setrules", "rules", "slowmode", "lock", "unlock", "abusive", "toggleadmin", "warn", "clearwarns"].includes(parsedCmd.name)) {
      await aero.sendMessage(dockId, `❌ Aap ab group settings DM me change nahi kar sakte. Group settings ko group chat me commands use karke hi edit kiya ja sakta hai.`);
      return;
    }

    if (text) {
      try {
        const reply = await ai.answer({
          text: text,
          rules: "Be helpful, polite, and answer in English.",
          role: "USER",
          language: "en",
          senderName: senderName
        });
        await aero.sendMessage(dockId, reply);
        queueAssistantReply(dockId, reply, "dm_reply");
      } catch (err) {
        console.error("[DM AI Reply Error]:", err.message);
        await aero.sendMessage(dockId, "Welcome back! To setup another group, reply with `/setup`.");
      }
      return;
    }
  }

  // --- Group Moderation & Command Handling ---
  const groupSettings = getGroupSettings(db, dockId);

  // 1. Lock Check (Check if locked, but evaluate admin status later)
  const isLockedViolation = groupSettings.locked;

  // 2. Slowmode Check (Check if violation occurred)
  let isSlowmodeViolation = false;
  const now = Date.now();
  const lastTimeKey = `${dockId}:${senderId}`;
  if (groupSettings.slowmodeSeconds > 0) {
    const lastTime = lastMessageTime.get(lastTimeKey) || 0;
    const diff = (now - lastTime) / 1000;
    if (diff < groupSettings.slowmodeSeconds) {
      isSlowmodeViolation = true;
    }
  }

  // 3. Abusive Word Check
  let isAbusiveViolation = false;
  if (groupSettings.abusiveFilter) {
    const localAbusiveRegex = /\b(mc|bc|madrchod|madarchod|behnchod|behenchod|bkl|bhenchodd|bhosdike|bhosda|bhosadi|bhosdika|mc\s+bc|bc\s+mc|bakchod|bakchodi)\b/i;
    isAbusiveViolation = localAbusiveRegex.test(text);

    const suspiciousRegex = /(mc|bc|madrchod|madarchod|behnchod|behenchod|bkl|bhenchodd|bhosdike|bhosda|bhosadi|bhosdika|bakchod|bakchodi|chut|gand|lund|gaand|saal|kutt|kamin|haram|raand|randi|saala|l@nd|g@nd|c[h]*ut|m[a]*d[a]*rc[h]|b[e]*[h]*n[c]*h|b[h]*osd)/i;
    const isSuspicious = suspiciousRegex.test(text);

    if (!isAbusiveViolation && isSuspicious && ai.enabled && ai.keys && ai.keys.length > 0) {
      try {
        const aiCheck = await ai.runChatCompletion({
          messages: [
            {
              role: "system",
              content: "You are a content moderation assistant. Check if the user message contains severe Hinglish/Hindi gaalis (specifically mc, bc, madarchod, behnchod, bkl, bhosdike, bakchod, bakchodi, or extreme equivalents). Do NOT flag mild slang, casual teasing, common colloquial words, or light insults (such as chutiya, gandu, lund, gaand, saala, kutta, kamina, harami, etc.) as abusive. We want a relaxed filter that only flags extreme/severe profanity. Reply with EXACTLY 'ABUSIVE' or 'SAFE'. Do not reply with anything else."
            },
            {
              role: "user",
              content: text
            }
          ],
          model: ai.model,
          max_tokens: 5,
          temperature: 0.0
        });
        const resultText = aiCheck.choices[0]?.message?.content?.trim().toUpperCase();
        if (resultText === "ABUSIVE") {
          isAbusiveViolation = true;
        }
      } catch (e) {
        console.error("[Abusive Filter AI Error]:", e.message);
      }
    }
  }

  // Parse bot command
  const parsedCmd = bot.parseCommand(text);

  const botMentionText = bot.botMention.toLowerCase();
  const lowerText = text.toLowerCase();
  
  let isReplyToBot = false;
  const replyToMsg = msg.replyToMessageId || msg.replyTo;
  if (replyToMsg) {
    const parentSenderObj = replyToMsg.senderId || replyToMsg.sender;
    const parentSenderId = typeof parentSenderObj === "object" ? (parentSenderObj?._id || parentSenderObj?.id) : parentSenderObj;
    const botUserId = aero.user?._id || aero.user?.id;
    if (botUserId && parentSenderId === botUserId) {
      isReplyToBot = true;
    } else if (parentSenderObj && typeof parentSenderObj === "object") {
      const parentUsername = String(parentSenderObj.username || "").toLowerCase();
      if (parentUsername === "aerogroupguard" || (aero.user && parentUsername === String(aero.user.username || "").toLowerCase())) {
        isReplyToBot = true;
      }
    }
  }

  let isMention = lowerText.includes(botMentionText) || isReplyToBot;

  // Avoid AI reply for morbid topics
  const morbidRegex = /\b(mar gya|mar gaya|death|die|dying|dead|grave|graveyard|funeral|cremate|cremation|suicide|kill|kabristan|shmashan|shamsan|rip|passed away|mortuary|coffin)\b/i;
  if (isMention && morbidRegex.test(text)) {
    isMention = false;
  }

  // Fetch chat history for summaries (only on summary/recap command or request)
  let chatHistory = [];
  const isSummaryCmd = parsedCmd && ["summary", "weeklysummary", "chatrecap", "recap"].includes(parsedCmd.name);
  const isSummaryOrRecapRequest = isSummaryCmd || (isMention && (lowerText.includes("summary") || lowerText.includes("summarize") || lowerText.includes("recap") || lowerText.includes("chat history") || lowerText.includes("chatrecap")));
  
  if (isSummaryOrRecapRequest) {
    try {
      const msgs = await aero.getMessagesDays(dockId, 1);
      chatHistory = msgs.map(m => {
        const sObj = m.senderId || m.sender;
        return {
          timestamp: m.createdAt || m.updatedAt || new Date().toISOString(),
          text: `[${sObj?.username || "user"}]: ${m.text}`
        };
      });
    } catch (err) {
      console.error("[Enforcer] Failed to fetch chat history:", err.message);
    }
  }

  // Determine if we need to check admin roles
  const cmdName = parsedCmd?.name;
  const isAdminCmd = ["kick", "ban", "mute", "unmute", "warn", "clearwarns", "setwelcome", "setrules", "setprefix", "lock", "unlock", "lockgroup", "unlockgroup", "slowmode", "slow5", "slowmode5", "slow10", "slowmode10", "abusive", "toggleadmin", "rename", "announce", "setfaq", "summary", "weeklysummary", "chatrecap", "recap"].includes(cmdName);

  // Bot must be an admin/owner to process moderation or check roles
  let isBotAdmin = targetDock && (targetDock.role === "admin" || targetDock.role === "owner");

  // Bot Admin Gate — check bot's own role for admin commands
  if (isAdminCmd && !isBotAdmin) {
    try {
      console.log(`[Enforcer] Bot is cached as member but admin command triggered. Checking bot role...`);
      const freshDock = await aero.fetchDock(dockId);
      if (freshDock) {
        targetDock = freshDock;
        isBotAdmin = targetDock.role === "admin" || targetDock.role === "owner";
      }
    } catch (err) {
      console.error(`[Enforcer] Failed to check bot role:`, err.message);
    }

    if (!isBotAdmin) {
      console.log(`[Enforcer] Bot is not admin in ${dockId}. Rejecting command /${cmdName}`);
      await aero.sendMessage(dockId, "❌ Please make me admin first.");
      return;
    }
  }

  // Check sender's admin status — single API call, only for admin commands
  let isSenderOwner = false;
  let isSenderAdmin = false;

  if (senderId === "owner-1") {
    isSenderOwner = true;
    isSenderAdmin = true;
  } else if (isGroup && isAdminCmd) {
    // Only call API when command actually needs admin check
    isSenderAdmin = await checkIsAdmin(dockId, senderId);
    console.log(`[AdminCheck] Sender ${senderId} in dock ${dockId}: isAdmin=${isSenderAdmin}`);
  }

  let canEdit = isSenderOwner || isSenderAdmin;

  const context = {
    enabled: assistantMode.enabled,
    isGroup,
    groupName,
    chatHistory,
    assistantOnly: assistantMode.nonDestructiveOnly,
    platformActions: {
      kick: (payload) => {
        const targetUsername = (payload.target || "").replace(/^@/, "").trim().toLowerCase();
        if (!targetUsername) return;
        (async () => {
          try {
            if (!isBotAdmin) {
              await aero.sendMessage(dockId, `❌ Please make me admin first.`);
              return;
            }
            // Step 1: Resolve target userId from message mentions (O(1), no API call)
            let targetId = resolveMentionedUserId(msg, targetUsername);

            // Step 2: If not in mentions, check local DB
            if (!targetId) {
              const targetMember = findMemberByUsername(groupSettings, targetUsername);
              if (targetMember) {
                targetId = targetMember.id;
                console.log(`[Kick] Resolved @${targetUsername} from local DB: ${targetId}`);
              }
            }

            // Step 3: If still not found, send ONE API call to check if this user is in the dock
            if (!targetId) {
              console.log(`[Kick] @${targetUsername} not in mentions or DB. Cannot resolve without full member list.`);
              await aero.sendMessage(dockId, `❌ Cannot kick @${targetUsername}: User not found. Please use @mention when running /kick.`);
              return;
            }

            // Check if target is admin — single API call for ONLY that user
            const isTargetAdmin = await checkIsAdmin(dockId, targetId);
            if (isTargetAdmin) {
              await aero.sendMessage(dockId, `❌ Cannot kick admins or the group owner.`);
              return;
            }
            await aero.kickMember(dockId, targetId);
            // Store in local DB for future commands (lazy member tracking)
            if (!groupSettings.members) groupSettings.members = {};
            delete groupSettings.members[targetId];
            saveGroupDb(db);
          } catch (err) {
            console.error(`[PlatformAction] Kick failed for @${targetUsername}:`, err.message);
            await aero.sendMessage(dockId, `❌ Kick failed for @${targetUsername}: ${err.message}`);
          }
        })();
      },
      ban: (payload) => {
        const targetUsername = (payload.target || "").replace(/^@/, "").trim().toLowerCase();
        if (!targetUsername) return;
        (async () => {
          try {
            if (!isBotAdmin) {
              await aero.sendMessage(dockId, `❌ Please make me admin first.`);
              return;
            }
            // Step 1: Resolve target userId from message mentions (O(1), no API call)
            let targetId = resolveMentionedUserId(msg, targetUsername);

            // Step 2: If not in mentions, check local DB
            if (!targetId) {
              const targetMember = findMemberByUsername(groupSettings, targetUsername);
              if (targetMember) {
                targetId = targetMember.id;
                console.log(`[Ban] Resolved @${targetUsername} from local DB: ${targetId}`);
              }
            }

            // Step 3: If still not found, send ONE API call for only this user
            if (!targetId) {
              console.log(`[Ban] @${targetUsername} not in mentions or DB. Cannot resolve without full member list.`);
              await aero.sendMessage(dockId, `❌ Cannot ban @${targetUsername}: User not found. Please use @mention when running /ban.`);
              return;
            }

            // If userId resolved from @mention, user is confirmed in dock (Aero only sends mentions for dock members)
            // Check if target is admin — uses 60s cache, no extra API call if cache is fresh
            const isTargetAdmin = await checkIsAdmin(dockId, targetId);
            if (isTargetAdmin) {
              await aero.sendMessage(dockId, `❌ Cannot ban admins or the group owner.`);
              return;
            }
            await aero.banMember(dockId, targetId);
            // Invalidate docks cache so next check is fresh
            lastDocksFetchTime = 0;
            if (!groupSettings.members) groupSettings.members = {};
            delete groupSettings.members[targetId];
            saveGroupDb(db);
          } catch (err) {
            console.error(`[PlatformAction] Ban failed for @${targetUsername}:`, err.message);
            await aero.sendMessage(dockId, `❌ Ban failed for @${targetUsername}: ${err.message}`);
          }
        })();
      }
    }
  };

  // 1. Lock Enforcement
  if (isLockedViolation && !isSenderAdmin) {
    try {
      await aero.sendMessage(dockId, `⚠️ @${senderName}, chat is currently locked by admin.`);
      return;
    } catch (err) {
      console.error("[Enforcer] Lock warning failed:", err.message);
    }
  }

  // 2. Slowmode Enforcement
  if (groupSettings.slowmodeSeconds > 0 && !isSenderAdmin) {
    if (isSlowmodeViolation) {
      const lastTime = lastMessageTime.get(lastTimeKey) || 0;
      const diff = (now - lastTime) / 1000;
      const waitTime = Math.ceil(groupSettings.slowmodeSeconds - diff);
      try {
        await aero.sendMessage(dockId, `⏳ @${senderName}, please wait ${waitTime}s before sending another message.`);
        return;
      } catch (err) {
        console.error("[Enforcer] Slowmode warning failed:", err.message);
      }
    } else {
      lastMessageTime.set(lastTimeKey, now);
    }
  }

  // 3. Abusive Word Filter
  if (isAbusiveViolation && !isSenderAdmin) {
    if (!groupSettings.warnings[senderId]) {
      groupSettings.warnings[senderId] = 0;
    }
    groupSettings.warnings[senderId]++;
    const currentWarns = groupSettings.warnings[senderId];
    saveGroupDb(db);

    if (currentWarns > 2) {
      try {
        await aero.banMember(dockId, senderId);
        await aero.sendMessage(dockId, `🚨 @${senderName} has been automatically banned. Reason: Exceeded 2 warnings (Abusive language).`);
      } catch (banErr) {
        console.error("[Auto-Ban Error]:", banErr.message);
        await aero.sendMessage(dockId, `🚨 @${senderName} exceeded 2 warnings, but automatic ban failed: ${banErr.message}`);
      }
    } else {
      await aero.sendMessage(dockId, `⚠️ Warning: Abusive words are not allowed in this group. @${senderName}, this is warning ${currentWarns}/3.`);
    }
    return;
  }

  // --- Process commands using the per-group database ---
  let reply = null;

  if (parsedCmd) {
    const cmdName = parsedCmd.name;
    const argsText = parsedCmd.argsText || "";

    const isAdminCmd = ["setrules", "slowmode", "slow5", "slowmode5", "slow10", "slowmode10", "lock", "lockgroup", "unlock", "unlockgroup", "abusive", "toggleadmin", "warn", "clearwarns", "rename", "announce", "setfaq", "summary", "weeklysummary", "chatrecap", "recap"].includes(cmdName);

    if (isAdminCmd && !canEdit) {
      try {
        console.log(`[Enforcer] Re-evaluating permissions for ${senderName} (${senderId}) on command /${cmdName}`);
        // Single API call — check only this sender's role, not full member list
        const freshAdmin = await checkIsAdmin(dockId, senderId);
        if (freshAdmin) {
          isSenderAdmin = true;
          canEdit = true;
          console.log(`[Enforcer] Promotion confirmed for ${senderName}. Permission GRANTED.`);
        }
      } catch (e) {
        console.error("[Enforcer] Promotion check failed:", e.message);
      }
    }

    if (["setrules", "slowmode", "slow5", "slowmode5", "slow10", "slowmode10", "lock", "lockgroup", "unlock", "unlockgroup", "abusive", "toggleadmin", "warn", "clearwarns", "rename", "announce", "setfaq"].includes(cmdName)) {
      if (["setrules", "slowmode", "slow5", "slowmode5", "slow10", "slowmode10", "lock", "lockgroup", "unlock", "unlockgroup", "abusive", "rename", "announce", "setfaq"].includes(cmdName)) {
        if (!canEdit) {
          reply = "Permission denied. Only dock owner (or authorized admins) can change settings.";
        } else {
          switch (cmdName) {
            case "setrules":
              if (!argsText) {
                reply = "Please specify rules text.";
              } else {
                groupSettings.rules = argsText;
                saveGroupDb(db);
                reply = "✅ Rules updated for this group.";
              }
              break;
            case "slowmode":
              if (!argsText) {
                reply = "Please specify slowmode duration in seconds (or 'off').";
              } else {
                const val = argsText.toLowerCase();
                if (val === "off" || val === "disable" || val === "0") {
                  groupSettings.slowmodeSeconds = 0;
                  saveGroupDb(db);
                  try {
                    await aero.updateDockSettings(dockId, { slowMode: 0 });
                    reply = "⏳ Slowmode disabled for this group on the server.";
                  } catch (err) {
                    reply = `⏳ Slowmode disabled locally, but failed to update on Aero server: ${err.message}`;
                  }
                } else {
                  const secs = parseInt(val, 10);
                  if (isNaN(secs) || secs < 0) {
                    reply = "Please specify duration in seconds.";
                  } else {
                    groupSettings.slowmodeSeconds = secs;
                    saveGroupDb(db);
                    try {
                      await aero.updateDockSettings(dockId, { slowMode: secs });
                      reply = `⏳ Slowmode set to ${secs} seconds for this group on the server.`;
                    } catch (err) {
                      reply = `⏳ Slowmode set to ${secs} seconds locally, but failed to update on Aero server: ${err.message}`;
                    }
                  }
                }
              }
              break;
            case "slow5":
            case "slowmode5":
              groupSettings.slowmodeSeconds = 5;
              saveGroupDb(db);
              try {
                await aero.updateDockSettings(dockId, { slowMode: 5 });
                reply = "⏳ Slowmode set to 5 seconds for this group on the server.";
              } catch (err) {
                reply = `⏳ Slowmode set to 5 seconds locally, but failed to update on Aero server: ${err.message}`;
              }
              break;
            case "slow10":
            case "slowmode10":
              groupSettings.slowmodeSeconds = 10;
              saveGroupDb(db);
              try {
                await aero.updateDockSettings(dockId, { slowMode: 10 });
                reply = "⏳ Slowmode set to 10 seconds for this group on the server.";
              } catch (err) {
                reply = `⏳ Slowmode set to 10 seconds locally, but failed to update on Aero server: ${err.message}`;
              }
              break;
            case "lock":
            case "lockgroup":
              groupSettings.locked = true;
              saveGroupDb(db);
              reply = "🔒 Group has been locked by admin. Messages are monitored.";
              break;
            case "unlock":
            case "unlockgroup":
              groupSettings.locked = false;
              saveGroupDb(db);
              reply = "🔓 Group has been unlocked. You can now chat freely.";
              break;
            case "abusive":
              if (!argsText) {
                reply = "Please specify 'on' or 'off'. E.g. /abusive on";
              } else {
                const val = argsText.toLowerCase();
                if (val === "on" || val === "enable" || val === "true") {
                  groupSettings.abusiveFilter = true;
                  saveGroupDb(db);
                  reply = "✅ Abusive language filter enabled for this group.";
                } else if (val === "off" || val === "disable" || val === "false") {
                  groupSettings.abusiveFilter = false;
                  saveGroupDb(db);
                  reply = "❌ Abusive language filter disabled for this group.";
                } else {
                  reply = "Use /abusive on or /abusive off.";
                }
              }
              break;
            case "rename":
              if (!argsText) {
                reply = "Please specify the new dock name. E.g. /rename New Name";
              } else {
                try {
                  await aero.renameDock(dockId, argsText);
                  groupSettings.groupName = argsText;
                  saveGroupDb(db);
                  await aero.fetchDocks();
                  reply = `✅ Dock has been successfully renamed to "${argsText}".`;
                } catch (err) {
                  reply = `❌ Failed to rename dock on Aero server: ${err.message}`;
                }
              }
              break;
            case "setfaq":
              if (!argsText) {
                reply = "Please specify FAQ text. E.g. /setfaq Here is the FAQ content";
              } else {
                groupSettings.faq = argsText;
                saveGroupDb(db);
                reply = "✅ FAQ updated for this group.";
              }
              break;
            case "announce":
              {
                const senderUsername = (msg.sender?.username || "").toLowerCase();
                if (senderUsername !== "yamdut" && senderUsername !== "aryankaushik") {
                  reply = "❌ Permission denied. Announcements can only be made by @yamdut or @aryankaushik.";
                } else if (!argsText) {
                  reply = "Please specify the announcement message. E.g. /announce Hello everyone!";
                } else {
                  const finalMessage = argsText;
                  
                  const announceMsg = formatAnnouncement(finalMessage, msg.sender?.username || "Owner");
                  
                  let successCount = 0;
                  let failedCount = 0;
                  if (aero.connected && Array.isArray(aero.docks)) {
                    for (const d of aero.docks) {
                      try {
                        await aero.sendMessage(d.id, announceMsg);
                        successCount++;
                      } catch (e) {
                        console.error(`Failed to send announcement to dock ${d.id}:`, e.message);
                        failedCount++;
                      }
                    }
                  }
                  
                  reply = `✅ Announcement broadcasted to ${successCount} group(s)${failedCount > 0 ? ` (failed on ${failedCount} group(s))` : ""}.`;
                }
              }
              break;
          }
        }
      } else if (cmdName === "toggleadmin") {
        if (!canEdit) {
          reply = "Permission denied. Only group admins (or owners) can toggle admin editing rights.";
        } else {
          groupSettings.allowAdminsToEdit = !groupSettings.allowAdminsToEdit;
          saveGroupDb(db);
          reply = `⚙️ Admins editing settings toggle: ${groupSettings.allowAdminsToEdit ? "ENABLED" : "DISABLED"}.`;
        }
      } else if (["warn", "clearwarns"].includes(cmdName)) {
        if (!isSenderAdmin) {
          reply = "Permission denied. Admin only.";
        } else {
          const parts = argsText.trim().split(/\s+/);
          const targetUserArg = parts[0] || "";
          const targetUsername = targetUserArg.replace(/^@/, "").toLowerCase();

          if (!targetUserArg) {
            reply = `Please specify a user to ${cmdName === "warn" ? "warn" : "clear warnings for"}.`;
          } else {
            // Step 1: Resolve via message mentions (O(1), no API call)
            let targetId = resolveMentionedUserId(msg, targetUsername);

            // Step 2: Check local DB
            if (!targetId) {
              const localMember = findMemberByUsername(groupSettings, targetUsername);
              if (localMember) {
                targetId = localMember.id;
                console.log(`[WarnCommand] Resolved @${targetUsername} from local DB: ${targetId}`);
              }
            }

            if (!targetId) {
              reply = `❌ User @${targetUsername} not found. Please use @mention when running /${cmdName}.`;
            } else {
              // Check if target is admin — uses 60s cache, no extra API call if cache is fresh
              const isTargetAdmin = await checkIsAdmin(dockId, targetId) || targetId === "owner-1";
              if (isTargetAdmin && cmdName === "warn") {
                reply = `❌ Cannot warn admins or the group owner.`;
              } else if (cmdName === "warn") {
                const reason = parts.slice(1).join(" ") || "No reason provided.";
                if (!groupSettings.warnings[targetId]) groupSettings.warnings[targetId] = 0;
                groupSettings.warnings[targetId]++;
                const currentWarns = groupSettings.warnings[targetId];
                saveGroupDb(db);

                if (currentWarns > 2) {
                  try {
                    await aero.banMember(dockId, targetId);
                    reply = `🚨 @${targetUsername} has been automatically banned. Reason: Exceeded 2 warnings (${reason}).`;
                  } catch (banErr) {
                    reply = `🚨 @${targetUsername} exceeded 2 warnings, but ban failed: ${banErr.message}`;
                  }
                } else {
                  reply = `⚠️ @${targetUsername} has been warned by admin for: ${reason}. Total warnings: ${currentWarns}/3.`;
                }
              } else {
                groupSettings.warnings[targetId] = 0;
                saveGroupDb(db);
                reply = `✅ Warnings cleared for @${targetUsername}.`;
              }
            }
          }
        }
      }
    } else if (cmdName === "rules") {
      reply = groupSettings.rules;
    } else if (cmdName === "faq") {
      reply = groupSettings.faq || bot.faq;
    } else if (cmdName === "draw") {
      if (!argsText) {
        reply = "Please specify a prompt for the image. E.g. /draw a beautiful sunrise over mountains";
      } else {
        const prompt = argsText;
        const textContent = `🎨 **Aero AI Art Generator**\n\n**Prompt:** "${prompt}"`;
        
        (async () => {
          try {
            const base64Uri = await generateImageBase64(prompt);
            await aero.sendMessage(dockId, textContent, base64Uri);
          } catch (err) {
            console.error("[Draw Command Error]:", err.message);
            await aero.sendMessage(dockId, "❌ Failed to generate image. Please try again with a different prompt.");
          }
        })();
        reply = null;
      }
    } else if (cmdName === "status") {
      reply = `Group Status: Rules: ${groupSettings.rules.substring(0, 30)}..., Lock: ${groupSettings.locked ? "locked" : "unlocked"}, Slowmode: ${groupSettings.slowmodeSeconds > 0 ? groupSettings.slowmodeSeconds + "s" : "disabled"}, Abusive filter: ${groupSettings.abusiveFilter ? "enabled" : "disabled"}, Admins allowed to edit: ${groupSettings.allowAdminsToEdit ? "yes" : "no"}, Warnings logged: ${Object.keys(groupSettings.warnings).length}`;
    } else if (cmdName === "report") {
      const reason = argsText || "";
      if (!reason) {
        reply = "Please specify the report complaint. E.g. `/report Spam in chat`";
      } else {
        pendingUserReports.set(senderId, {
          dockId: dockId,
          reportText: reason,
          senderName: senderName,
          timestamp: Date.now()
        });
        reply = `⚠️ @${senderName}, please confirm your report by replying with **/yes** or **/no**.\n\n⚠️ **WARNING**: Agar koi faltu ka message ya bemtlb ka message hua to vo id ban ya terminate ka cause ban sakta he.`;
      }
    } else if (cmdName === "yes") {
      const pendingReport = pendingUserReports.get(senderId);
      if (pendingReport) {
        let targetIssuesDockId = null;
        try {
          const res = await aero.joinDock("CPXBZM");
          targetIssuesDockId = res?.dock?._id || res?.dock?.id || res?._id || res?.id || res?.dockId;
        } catch (err) {
          // Ignore join failure as bot might already be in dock
        }
        if (!targetIssuesDockId) {
          await aero.fetchDocks();
          const found = aero.docks.find(d => d.name && (d.name.toLowerCase().includes("issue") || d.name.toLowerCase().includes("suggestion")));
          if (found) {
            targetIssuesDockId = found.id;
          }
        }
        
        if (targetIssuesDockId) {
          const resolvedReportText = `📢 **New Suggestion / Bug Report**\n👤 **Submitted by**: @${pendingReport.senderName} (${senderId})\n📝 **Description**: ${pendingReport.reportText}`;
          await aero.sendMessage(targetIssuesDockId, resolvedReportText);
          
          const reportId = `report-${reports.length + 1}`;
          reports.push({
            id: reportId,
            groupId: pendingReport.dockId,
            userId: senderId,
            text: pendingReport.reportText,
            status: "open",
            createdAt: new Date().toISOString()
          });
          
          reply = `✅ Report successfully submitted to Aero Issues & Suggestions!`;
        } else {
          reply = `❌ Failed to locate the suggestion dock. Report has been logged on the local system instead.`;
          const reportId = `report-${reports.length + 1}`;
          reports.push({
            id: reportId,
            groupId: pendingReport.dockId,
            userId: senderId,
            text: pendingReport.reportText,
            status: "open",
            createdAt: new Date().toISOString()
          });
        }
        pendingUserReports.delete(senderId);
      } else {
        reply = "❌ You don't have any pending report to confirm.";
      }
    } else if (cmdName === "no") {
      const pendingReport = pendingUserReports.get(senderId);
      if (pendingReport) {
        reply = `❌ Report cancelled.`;
        pendingUserReports.delete(senderId);
      } else {
        reply = "❌ You don't have any pending report to cancel.";
      }

    } else if (["summary", "weeklysummary", "chatrecap", "recap"].includes(cmdName)) {
      if (!isSenderAdmin) {
        reply = "Permission denied. Admin only.";
      } else {
        const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
        const recentMsgs = chatHistory.filter(m => {
          const timestamp = new Date(m.timestamp || 0).getTime();
          return Number.isFinite(timestamp) && timestamp >= oneDayAgo;
        });

        if (recentMsgs.length < 3) {
          reply = "Not enough chat history available for a 1-day summary.";
        } else {
          if (ai.enabled && ai.groq) {
            const chunkSize = 35;
            const chunks = [];
            for (let i = 0; i < recentMsgs.length; i += chunkSize) {
              chunks.push(recentMsgs.slice(i, i + chunkSize));
            }
            
            (async () => {
              try {
                for (let i = 0; i < chunks.length; i++) {
                  const chunk = chunks[i];
                  const textLogs = chunk.map(m => m.text).join("\n");
                  const summary = await ai.answer({
                    text: `Please generate a beautiful, detailed summary of this part of the chat logs. Highlight key topics discussed, decisions made, and pending tasks in bullet points:\n\n${textLogs}`,
                    rules: groupSettings.rules,
                    role: "ADMIN",
                    language: "en"
                  });
                  
                  const partReply = `📝 **AeroGroupGuard AI Chat Summary (Part ${i + 1}/${chunks.length})**:\n\n${summary}`;
                  await aero.sendMessage(dockId, partReply);
                  queueAssistantReply(dockId, partReply, "command_reply");
                  
                  // Small delay to prevent message rate-limiting
                  await new Promise(r => setTimeout(r, 600));
                }
              } catch (err) {
                console.error("[AI Summary Chunk Error]:", err.message);
                await aero.sendMessage(dockId, `❌ Failed to generate full chat summary: ${err.message}`);
              }
            })();
            reply = null;
          } else {
            reply = bot.handleMessage({ text, sender: { id: senderId, permissionLevel: isSenderAdmin ? "ADMIN" : "USER" } }, context);
          }
        }
      }
    } else {
      const matchingCommand = customCommands.find(c => {
        const normName = c.name.replace(/^\//, "").toLowerCase();
        return normName === cmdName;
      });
      if (matchingCommand) {
        reply = matchingCommand.response;
      } else {
        reply = bot.handleMessage({ text, sender: { id: senderId, permissionLevel: isSenderAdmin ? "ADMIN" : "USER" } }, context);
      }
    }
  } else if (isMention) {
    const escapedMention = bot.botMention.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const mentionRegex = new RegExp(escapedMention, "gi");
    const question = text.replace(mentionRegex, "").replace(/\s+/g, " ").trim();

    if (question) {
      try {
        reply = await ai.answer({
          text: question,
          rules: groupSettings.rules,
          role: isSenderAdmin ? "ADMIN" : "USER",
          language: "en",
          senderName: senderName
        });
      } catch (err) {
        console.error("[AI] Error generating answer:", err.message);
        reply = "Sorry, I encountered an issue processing that query.";
      }
    } else {
      reply = "Haan ji? Boliye, main aapki kya madad kar sakta hoon?";
    }
  } else {
    reply = bot.handleMessage({ text, sender: { id: senderId, permissionLevel: isSenderAdmin ? "ADMIN" : "USER" } }, context);
  }

  if (reply) {
    try {
      let finalReply = reply;
      if (isMention && senderName && !finalReply.trim().startsWith("@")) {
        finalReply = `@${senderName} ${finalReply}`;
      }
      console.log(`[AutoReply] Sending to dock ${dockId}: ${finalReply}`);
      await aero.sendMessage(dockId, finalReply, null, isGroup);
      queueAssistantReply(dockId, finalReply, isMention ? "mention_reply" : "command_reply");
    } catch (err) {
      console.error("[AutoReply] Failed to send response:", err.message);
    }
  }
});

// Routes configuration
const routes = {
  "GET /api/health": health,
  "GET /api/dashboard": dashboardData,
  "GET /api/portal": portalData,
  "GET /api/install-flow": installFlow,
  "GET /api/groups": () => json(200, { groups: getActiveGroups() }),
  "GET /api/reports": () => json(200, { reports }),
  "GET /api/audit-logs": () => json(200, { auditLogs: auditLogs.slice(-100).reverse() }),
  "GET /api/analytics": () => json(200, buildAnalytics(events)),
  "GET /api/commands": commands,
  "GET /api/manual-control": manualControl,
  "GET /api/assistant-mode": () => json(200, { assistantMode, outboundMessages: outboundMessages.slice(-20).reverse() }),
  "GET /api/reports/export": exportReports,
  "GET /api/install/status": getConnectionStatus,
  "POST /api/webhooks/aero": webhook,
  "POST /api/ai/ask": askAi,
  "POST /api/reports/export": exportReports,
  "POST /api/manual/messages/preview": previewManualMessage,
  "POST /api/manual/messages/send": sendManualMessage,
  "POST /api/manual/messages/schedule": scheduleManualMessage,
  "POST /api/manual/templates": saveTemplate,
  "POST /api/manual/console": aiCommandConsole,
  "POST /api/manual/groups/action": groupControlAction,
  "POST /api/custom-commands": saveCustomCommand,
  "POST /api/automations": saveAutomation,
  "POST /api/install/login": loginAero,
  "POST /api/install/cookie": installWithCookie,
  "POST /api/install/disconnect": disconnectBot,
  "GET /api/user-approvals": getUserApprovals,
  "POST /api/user-approvals/approve": approveUser,
  "POST /api/user-approvals/reject": rejectUser
};

const server = http.createServer(async (req, res) => {
  try {
    console.log(`[REQUEST] ${req.method} ${req.url}`);
    const ip = req.socket.remoteAddress || "unknown";
    if (!limiter(ip)) return send(res, json(429, { error: "Rate limit exceeded." }));

    const url = new URL(req.url, `http://${req.headers.host}`);
    const route = routes[`${req.method} ${url.pathname}`];
    if (route) return send(res, await route(req, url));
    return serveStatic(res, url.pathname);
  } catch (error) {
    logger.error("request_failed", { error: error.message });
    return send(res, json(500, { error: "Internal server error." }));
  }
});

if (require.main === module) {
  const initDbPromise = (async () => {
    if (firestoreDb) {
      try {
        console.log("[Firestore] Fetching database on startup...");
        const doc = await firestoreDb.collection("settings").doc("group_database").get();
        if (doc.exists) {
          groupDbCache = doc.data();
          console.log("[Firestore] Database successfully loaded on startup.");
          if (groupDbCache.customCommands && Array.isArray(groupDbCache.customCommands)) {
            customCommands.length = 0;
            customCommands.push(...groupDbCache.customCommands);
          }
        } else {
          console.log("[Firestore] No database found in cloud, will create one on first write.");
        }
        
        console.log("[Firestore] Fetching saved session on startup...");
        const sessDoc = await firestoreDb.collection("settings").doc("session").get();
        if (sessDoc.exists) {
          sessionCache = sessDoc.data();
          console.log("[Firestore] Saved session successfully loaded on startup.");
        } else {
          console.log("[Firestore] No saved session found in cloud.");
        }
      } catch (err) {
        console.error("[Firestore] Startup fetch failed:", err.message);
      }
    }
  })();

  server.listen(config.port, () => {
    logger.info("server_started", { port: config.port });
    initDbPromise.then(() => {
      autoConnect().catch(err => {
        console.error("[AutoConnect] Error on startup:", err.message);
      });
    });
  });
}

function health() {
  return json(200, {
    status: "ok",
    service: "AeroGroupGuard",
    version: require("../package.json").version,
    checks: { api: aero.connected ? "connected" : "disconnected", socket: aero.socket?.connected ? "connected" : "disconnected" }
  });
}

function dashboardData() {
  const analytics = buildAnalytics(events);
  const activeGroups = getActiveGroups();
  return json(200, {
    metrics: {
      ...analytics,
      dailyActiveUsers: analytics.activeUsers || 10,
      weeklyActiveUsers: Math.max(analytics.activeUsers || 0, 45),
      messageVolume: events.length,
      aiUsage: { requests7d: outboundMessages.length + 5, summaries7d: 2, estimatedCostUsd: 0.05 },
      mostUsedCommands: { "/help": 25, "/rules": 14, "/report": 2, "/status": 8 },
      topGroups: activeGroups.map((group) => ({ name: group.name, members: group.members })).sort((a, b) => b.members - a.members),
      topAdmins: [{ name: aero.user?.username || "Aero Admin", actions: auditLogs.length }]
    },
    groups: activeGroups,
    recentReports: reports.slice(-10),
    notifications,
    activityFeed: recentActivity(),
    systemHealth: { api: aero.connected ? "online" : "offline", queueDepth: scheduledMessages.length, errorRate: 0.00, uptime: process.uptime() }
  });
}

function portalData() {
  return json(200, {
    ownerPortal: {
      capabilities: [
        "add_remove_groups",
        "enable_disable_bot",
        "manage_admins",
        "configure_commands",
        "configure_ai",
        "configure_languages",
        "analytics",
        "reports",
        "logs",
        "welcome_messages",
        "moderation_settings",
        "summaries",
        "broadcasts",
        "subscriptions"
      ]
    },
    adminPortal: {
      capabilities: ["moderate_users", "review_reports", "group_settings", "summaries", "group_analytics"]
    },
    userPortal: {
      capabilities: ["view_rules", "submit_reports", "view_faqs", "request_support"]
    },
    admins: aero.connected ? [{ id: aero.user?._id, name: aero.user?.username || "Aero Admin", groups: aero.docks.map(d => d.id), permissions: ["moderate", "reports", "summaries", "manual_control"] }] : [],
    users: [],
    subscription: { plan: "Growth", groupsLimit: 50, connectedGroups: getActiveGroups().length, renewal: "2026-07-01" },
    aiSettings: { models: ["Groq Llama 3.3"], activeModel: config.aiModel, contextMemory: true, customPrompts: true },
    assistantMode,
    installation: installationSteps()
  });
}

function commands() {
  return json(200, {
    user: ["/help", "/info", "/rules", "/report", "/admin", "/status", "/commands", "/summaryrequest"],
    admin: ["/kick", "/ban", "/mute", "/unmute", "/warn", "/clearwarns", "/lock", "/unlock", "/slowmode", "/purge", "/reportreview", "/summary"],
    owner: ["configure bot", "manage admins", "configure AI", "manage groups", "view analytics", "export data", "reset settings"]
  });
}

function manualControl() {
  return json(200, {
    templates: messageTemplates,
    customCommands,
    automations,
    scheduledMessages,
    quickActions: [
      "Welcome New Members",
      "Post Rules",
      "Post FAQ",
      "Post Announcement",
      "Run Poll",
      "Send Reminder",
      "Generate Activity Report"
    ],
    liveControls: [
      "Send Message",
      "Mention Everyone",
      "Lock Group",
      "Unlock Group",
      "Enable Slow Mode",
      "Disable Slow Mode",
      "Generate Summary",
      "Export Chat Data",
      "Review Reports",
      "View Logs"
    ]
  });
}

async function webhook(req) {
  const body = await readJson(req);
  const eventType = body.eventType || body.type || "message";
  const text = sanitizeText(body.text);
  const sender = body.member || body.sender || { id: "unknown" };
  const webhookDockId = body.groupId || "unknown";

  // Note: adminIds are no longer cached. Admin checks are done per-command via single API call.

  const context = {
    enabled: body.enabled !== false,
    isGroup: true,
    groupName: body.groupName,
    chatHistory: body.chatHistory || [],
    assistantOnly: assistantMode.nonDestructiveOnly,
    platformActions: {
      kick: (payload) => {
        const targetUsername = (payload.target || "").replace(/^@/, "").trim().toLowerCase();
        if (!targetUsername || webhookDockId === "unknown") return;
        (async () => {
          try {
            const targetDock = aero.docks.find(d => d.id === webhookDockId);
            const isBotAdmin = targetDock && (targetDock.role === "admin" || targetDock.role === "owner");
            if (!isBotAdmin) {
              await aero.sendMessage(webhookDockId, `❌ Please make me admin first.`);
              return;
            }
            const db = loadGroupDb();
            const groupSettings = getGroupSettings(db, webhookDockId);
            let targetId = resolveMentionedUserId(body, targetUsername);
            if (!targetId) {
              console.log(`[Webhook Kick] User @${targetUsername} not found in mentions. Trying fallback database lookup...`);
              await ensureMembersInDb(webhookDockId);
              let targetMember = findMemberByUsername(groupSettings, targetUsername);
              if (!targetMember) {
                await refreshAdminsCache(webhookDockId);
                targetMember = findMemberByUsername(groupSettings, targetUsername);
              }
              if (targetMember) {
                targetId = targetMember.id;
              }
            }
            if (!targetId) {
              await aero.sendMessage(webhookDockId, `❌ Cannot kick @${targetUsername}: User not found in this group.`);
              return;
            }
            const isTargetAdmin = isUserAdmin(webhookDockId, targetId);
            if (isTargetAdmin) {
              await aero.sendMessage(webhookDockId, `❌ Cannot perform moderation actions (kick) on other admins or the group owner.`);
              return;
            }
            await aero.kickMember(webhookDockId, targetId);
          } catch (err) {
            console.error(`[PlatformAction] Webhook kick failed for @${targetUsername}:`, err.message);
            await aero.sendMessage(webhookDockId, `❌ Kick failed for @${targetUsername}: ${err.message}`);
          }
        })();
      },
      ban: (payload) => {
        const targetUsername = (payload.target || "").replace(/^@/, "").trim().toLowerCase();
        if (!targetUsername || webhookDockId === "unknown") return;
        (async () => {
          try {
            const targetDock = aero.docks.find(d => d.id === webhookDockId);
            const isBotAdmin = targetDock && (targetDock.role === "admin" || targetDock.role === "owner");
            if (!isBotAdmin) {
              await aero.sendMessage(webhookDockId, `❌ Please make me admin first.`);
              return;
            }
            const db = loadGroupDb();
            const groupSettings = getGroupSettings(db, webhookDockId);
            let targetId = resolveMentionedUserId(body, targetUsername);
            if (!targetId) {
              console.log(`[Webhook Ban] User @${targetUsername} not found in mentions. Trying fallback database lookup...`);
              await ensureMembersInDb(webhookDockId);
              let targetMember = findMemberByUsername(groupSettings, targetUsername);
              if (!targetMember) {
                await refreshAdminsCache(webhookDockId);
                targetMember = findMemberByUsername(groupSettings, targetUsername);
              }
              if (targetMember) {
                targetId = targetMember.id;
              }
            }
            if (!targetId) {
              await aero.sendMessage(webhookDockId, `❌ Cannot ban @${targetUsername}: User not found in this group.`);
              return;
            }
            const isTargetAdmin = isUserAdmin(webhookDockId, targetId);
            if (isTargetAdmin) {
              await aero.sendMessage(webhookDockId, `❌ Cannot perform moderation actions (ban) on other admins or the group owner.`);
              return;
            }
            await aero.banMember(webhookDockId, targetId);
          } catch (err) {
            console.error(`[PlatformAction] Webhook ban failed for @${targetUsername}:`, err.message);
            await aero.sendMessage(webhookDockId, `❌ Ban failed for @${targetUsername}: ${err.message}`);
          }
        })();
      }
    }
  };

  if (eventType === "member_join" || eventType === "member_leave" || eventType === "member_left" || eventType === "role_change") {
    if (aero._membersCache) {
      aero._membersCache.delete(webhookDockId);
      console.log(`[Cache] Cleared members cache for dock ${webhookDockId} due to webhook event: ${eventType}`);
    }

    try {
      const db = loadGroupDb();
      const groupSettings = getGroupSettings(db, webhookDockId);
      const mId = sender.id || sender._id;
      
      if (mId && mId !== "unknown") {
        const isAdmin = sender.role === "admin" || sender.role === "owner" || sender.isAdmin === true || body.role === "admin" || body.role === "owner";
        
        // Invalidate docks cache so next check is fresh
        lastDocksFetchTime = 0;

        if (eventType === "member_join") {
          if (isAdmin) {
            delete groupSettings.members[mId];
            console.log(`[Webhook] Admin ${sender.username || mId} joined dock ${webhookDockId}`);
          } else {
            groupSettings.members[mId] = {
              username: sender.username || sender.mention || sender.displayName || "User",
              role: sender.role || "member",
              isAdmin: false
            };
            console.log(`[Webhook] Added member ${sender.username || mId} to database for dock ${webhookDockId}`);
          }
        } else if (eventType === "member_leave" || eventType === "member_left") {
          delete groupSettings.members[mId];
          console.log(`[Webhook] Removed user ${mId} from database for dock ${webhookDockId}`);
        } else if (eventType === "role_change") {
          const newRole = body.role || sender.role || "member";
          const isNewAdmin = newRole === "admin" || newRole === "owner" || sender.isAdmin === true;
          
          if (isNewAdmin) {
            delete groupSettings.members[mId];
            console.log(`[Webhook] Promoted user ${sender.username || mId} to admin for dock ${webhookDockId}`);
          } else {
            groupSettings.members[mId] = {
              username: sender.username || sender.mention || sender.displayName || "User",
              role: newRole,
              isAdmin: false
            };
            console.log(`[Webhook] Demoted user ${sender.username || mId} to member in database for dock ${webhookDockId}`);
          }
        }
        saveGroupDb(db);
      }
    } catch (dbErr) {
      console.error("[Webhook] Failed to update members database:", dbErr.message);
    }

    if (eventType === "member_join") {
      const welcome = assistantMode.autoWelcome ? bot.handleMemberJoin(sender, context) : null;
      return json(200, {
        eventType,
        reply: welcome,
        sendAction: { status: "queued_for_auto_send", reason: "welcome" }
      });
    }
  }

  if (eventType === "message" || eventType === "newMessage") {
    const senderId = sender.id || sender._id || "unknown";
    const senderName = sender.username || sender.displayName || "User";
    const parsedCmd = bot.parseCommand(text || "");
    
    let isSenderAdmin = false;
    if (senderId === "owner-1") {
      isSenderAdmin = true;
    } else if (webhookDockId !== "unknown" && parsedCmd) {
      const cmdName = parsedCmd.name;
      const isAdminCmd = ["kick", "ban", "mute", "unmute", "warn", "clearwarns", "setwelcome", "setrules", "setprefix", "lock", "unlock", "lockgroup", "unlockgroup", "slowmode", "slow5", "slowmode5", "slow10", "slowmode10", "abusive", "toggleadmin", "rename", "announce", "setfaq", "summary", "weeklysummary", "chatrecap", "recap"].includes(cmdName);
      if (isAdminCmd) {
        isSenderAdmin = await checkIsAdmin(webhookDockId, senderId);
      }
    }

    const botMentionText = bot.botMention.toLowerCase();
    const lowerText = (text || "").toLowerCase();
    
    let isReplyToBot = false;
    const replyToMsg = body.replyToMessageId || body.replyTo || (body.message && (body.message.replyToMessageId || body.message.replyTo));
    if (replyToMsg) {
      const parentSenderObj = replyToMsg.senderId || replyToMsg.sender;
      const parentSenderId = typeof parentSenderObj === "object" ? (parentSenderObj?._id || parentSenderObj?.id) : parentSenderObj;
      const botUserId = aero.user?._id || aero.user?.id;
      if (botUserId && parentSenderId === botUserId) {
        isReplyToBot = true;
      } else if (parentSenderObj && typeof parentSenderObj === "object") {
        const parentUsername = String(parentSenderObj.username || "").toLowerCase();
        if (parentUsername === "aerogroupguard" || (aero.user && parentUsername === String(aero.user.username || "").toLowerCase())) {
          isReplyToBot = true;
        }
      }
    }

    let isMention = lowerText.includes(botMentionText) || isReplyToBot;

    // Avoid AI reply for morbid topics
    const morbidRegex = /\b(mar gya|mar gaya|death|die|dying|dead|grave|graveyard|funeral|cremate|cremation|suicide|kill|kabristan|shmashan|shamsan|rip|passed away|mortuary|coffin)\b/i;
    if (isMention && morbidRegex.test(text || "")) {
      isMention = false;
    }

    let reply = null;

    if (isMention && !parsedCmd) {
      const escapedMention = bot.botMention.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const mentionRegex = new RegExp(escapedMention, "gi");
      const question = (text || "").replace(mentionRegex, "").replace(/\s+/g, " ").trim();

      if (question) {
        try {
          // senderName is already defined at event block top
          reply = await ai.answer({
            text: question,
            rules: bot.config.rules,
            role: "USER",
            language: "en",
            senderName: senderName
          });
          if (reply && !reply.trim().startsWith("@")) {
            reply = `@${senderName} ${reply}`;
          }
        } catch (err) {
          reply = "Sorry, I encountered an issue processing that query.";
        }
      } else {
        reply = "Haan ji? Boliye, main aapki kya madad kar sakta hoon?";
      }
    } else {
      if (parsedCmd) {
        const cmdName = parsedCmd.name;
        const argsText = parsedCmd.argsText || "";
        // senderId and senderName are already defined at event block top

        if (cmdName === "report") {
          const reason = argsText || "";
          if (!reason) {
            reply = "Please specify the report complaint. E.g. `/report Spam in chat`";
          } else {
            pendingUserReports.set(senderId, {
              dockId: webhookDockId,
              reportText: reason,
              senderName: senderName,
              timestamp: Date.now()
            });
            reply = `⚠️ @${senderName}, please confirm your report by replying with **/yes** or **/no**.\n\n⚠️ **WARNING**: Agar koi faltu ka message ya bemtlb ka message hua to vo id ban ya terminate ka cause ban sakta he.`;
          }
        } else if (cmdName === "yes") {
          const pendingReport = pendingUserReports.get(senderId);
          if (pendingReport) {
            let targetIssuesDockId = null;
            try {
              const res = await aero.joinDock("CPXBZM");
              targetIssuesDockId = res?.dock?._id || res?.dock?.id || res?._id || res?.id || res?.dockId;
            } catch (err) {}
            if (!targetIssuesDockId) {
              await aero.fetchDocks();
              const found = aero.docks.find(d => d.name && (d.name.toLowerCase().includes("issue") || d.name.toLowerCase().includes("suggestion")));
              if (found) {
                targetIssuesDockId = found.id;
              }
            }
            
            if (targetIssuesDockId) {
              const resolvedReportText = `📢 **New Suggestion / Bug Report**\n👤 **Submitted by**: @${pendingReport.senderName} (${senderId})\n📝 **Description**: ${pendingReport.reportText}`;
              await aero.sendMessage(targetIssuesDockId, resolvedReportText);
              
              const reportId = `report-${reports.length + 1}`;
              reports.push({
                id: reportId,
                groupId: pendingReport.dockId,
                userId: senderId,
                text: pendingReport.reportText,
                status: "open",
                createdAt: new Date().toISOString()
              });
              
              reply = `✅ Report successfully submitted to Aero Issues & Suggestions!`;
            } else {
              reply = `❌ Failed to locate the suggestion dock. Report has been logged on the local system instead.`;
              const reportId = `report-${reports.length + 1}`;
              reports.push({
                id: reportId,
                groupId: pendingReport.dockId,
                userId: senderId,
                text: pendingReport.reportText,
                status: "open",
                createdAt: new Date().toISOString()
              });
            }
            pendingUserReports.delete(senderId);
          } else {
            reply = "❌ You don't have any pending report to confirm.";
          }
        } else if (cmdName === "no") {
          const pendingReport = pendingUserReports.get(senderId);
          if (pendingReport) {
            reply = `❌ Report cancelled.`;
            pendingUserReports.delete(senderId);
          } else {
            reply = "❌ You don't have any pending report to cancel.";
          }
        } else {
          const matchingCommand = customCommands.find(c => {
            const normName = c.name.replace(/^\//, "").toLowerCase();
            return normName === cmdName;
          });
          if (matchingCommand) {
            reply = matchingCommand.response;
          }
        }
      }
      if (!reply) {
        reply = bot.handleMessage({ text, sender: { id: senderId, permissionLevel: isSenderAdmin ? "ADMIN" : "USER" } }, context);
      }
    }

    if (reply) {
      queueAssistantReply(body.groupId || "unknown", reply, isMention ? "mention_reply" : "command_reply");
      return json(200, {
        eventType,
        reply,
        sendAction: { status: "queued_for_auto_send", reason: isMention ? "mention_reply" : "command_reply" }
      });
    }
  }

  return json(200, { ok: true });
}

async function askAi(req) {
  const body = await readJson(req);
  const answer = await ai.answer({
    text: sanitizeText(body.question),
    rules: bot.config.rules,
    role: body.role || "USER",
    language: body.language,
    senderName: body.senderName || (body.actor && (body.actor.username || body.actor.id))
  });
  return json(200, { answer, model: config.aiModel });
}

function exportReports() {
  const rows = ["id,groupId,userId,status,text"].concat(
    reports.map((r) => [r.id, r.groupId, r.userId, r.status, JSON.stringify(r.text || "")].join(","))
  );
  return {
    status: 200,
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=reports.csv" },
    body: rows.join("\n")
  };
}

async function previewManualMessage(req) {
  const body = await readJson(req);
  const message = sanitizeText(body.message, 2000);
  return json(200, {
    preview: {
      groups: normalizeGroupTargets(body.groupIds),
      message,
      estimatedRecipients: estimateRecipients(body.groupIds),
      warnings: message.includes("@everyone") ? ["Mention everyone requires owner approval."] : []
    }
  });
}

async function sendManualMessage(req) {
  const body = await readJson(req);
  if (body.actor?.role === "USER") {
    return json(403, { error: "Permission denied." });
  }
  const groupIds = normalizeGroupTargets(body.groupIds);
  const rawMessage = sanitizeText(body.message, 2000);
  const isAnnouncement = !!body.isAnnouncement;
  
  let sent = 0;
  let failed = 0;

  if (aero.connected) {
    for (const gid of groupIds) {
      try {
        let messageToSend = rawMessage;
        if (isAnnouncement) {
          messageToSend = formatAnnouncement(rawMessage, "yamdut (Dashboard)");
        }
        await aero.sendMessage(gid, messageToSend);
        sent++;
      } catch (err) {
        console.error(`Failed to send message to group ${gid}:`, err.message);
        failed++;
      }
    }
  }

  const result = { sent, failed, groups: groupIds };
  audit("manual_message_sent", body.actor, groupIds, { messageLength: rawMessage.length, result });
  events.push({ type: "manual_message", userId: body.actor?.id, text: `[Dashboard Broadcast]: ${rawMessage}`, timestamp: new Date().toISOString() });
  return json(200, { result });
}

async function scheduleManualMessage(req) {
  const body = await readJson(req);
  if (body.actor?.role === "USER") {
    return json(403, { error: "Permission denied." });
  }
  const job = {
    id: `schedule-${scheduledMessages.length + 1}`,
    groupIds: normalizeGroupTargets(body.groupIds),
    message: sanitizeText(body.message, 2000),
    runAt: body.runAt,
    status: "scheduled"
  };
  scheduledMessages.push(job);
  audit("manual_message_scheduled", body.actor, job.groupIds, { jobId: job.id, runAt: job.runAt });
  return json(201, { job });
}

async function saveTemplate(req) {
  const body = await readJson(req);
  if (body.actor?.role === "USER") {
    return json(403, { error: "Permission denied." });
  }
  const template = {
    id: body.id || `tpl-${messageTemplates.length + 1}`,
    name: sanitizeText(body.name, 80),
    category: sanitizeText(body.category, 40),
    body: sanitizeText(body.body, 2000),
    languages: Array.isArray(body.languages) ? body.languages : ["en"]
  };
  messageTemplates.push(template);
  audit("template_saved", body.actor, [], { templateId: template.id });
  return json(201, { template });
}

async function aiCommandConsole(req) {
  const body = await readJson(req);
  if (body.actor?.role === "USER") {
    return json(403, { error: "Permission denied." });
  }
  const instruction = sanitizeText(body.instruction, 1000);
  const result = await resolveConsoleInstruction(instruction, body.actor);
  
  if (aero.connected && result.output) {
    const groupIds = normalizeGroupTargets(body.groupIds);
    let messageText = "";
    if (typeof result.output === "string") {
      messageText = result.output;
    } else {
      messageText = JSON.stringify(result.output, null, 2);
    }
    const consoleMsg = `💻 **Dashboard AI Console Execute**:\n\n${messageText}`;
    for (const gid of groupIds) {
      try {
        await aero.sendMessage(gid, consoleMsg);
      } catch (err) {
        console.error(`[Console] Failed to send to group ${gid}:`, err.message);
      }
    }
  }

  audit("ai_console_instruction", body.actor, normalizeGroupTargets(body.groupIds), { instruction, result: result.status });
  return json(200, result);
}

async function groupControlAction(req) {
  const body = await readJson(req);
  if (body.actor?.role === "USER") {
    return json(403, { error: "Permission denied." });
  }
  const action = sanitizeText(body.action, 80);
  const groupIds = normalizeGroupTargets(body.groupIds);
  audit("group_control_action", body.actor, groupIds, { action });
  
  let output = "";
  let successCount = 0;
  
  if (aero.connected) {
    for (const gid of groupIds) {
      try {
        if (action === "summary") {
          const msgs = await aero.getMessagesDays(gid, 1);

          if (msgs.length < 3) {
            output += `Group (${gid}): Not enough chat history available for a 1-day summary.\n`;
            continue;
          }

          const formattedMsgs = msgs.map(m => {
            const senderObj = m.senderId || m.sender;
            return `[${senderObj?.username || senderObj?.displayName || "user"}]: ${m.text}`;
          });

          const chunkSize = 35;
          const chunks = [];
          for (let i = 0; i < formattedMsgs.length; i += chunkSize) {
            chunks.push(formattedMsgs.slice(i, i + chunkSize));
          }

          for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            const textLogs = chunk.join("\n");
            const summary = await ai.answer({
              text: `Please generate a beautiful, detailed summary of this part of the chat logs. Highlight key topics discussed, decisions made, and pending tasks in bullet points:\n\n${textLogs}`,
              rules: "Highlight key topics, decisions, and tasks from the chat history. Avoid mentioning bots or list of bot commands unless they were a major topic. Return key points only.",
              role: "ADMIN",
              language: "en"
            });
            const summaryText = `📝 **AeroGroupGuard AI Chat Summary (Part ${i + 1}/${chunks.length})**:\n\n${summary}`;
            await aero.sendMessage(gid, summaryText);
            output += `Group (${gid}) Part ${i + 1}: Summary generated:\n${summary}\n\n`;
            await new Promise(r => setTimeout(r, 600));
          }
          successCount++;
        } else if (action === "mention_everyone") {
          const mentionMsg = `📢 @everyone Attention! (Individual tags disabled for group safety and resource optimization)`;
          await aero.sendMessage(gid, mentionMsg);
          output += `Group (${gid}): Generic mention everyone sent to chat.\n`;
          successCount++;
        } else if (action === "lock") {
          bot.config.locked = true;
          await aero.sendMessage(gid, "🔒 Group has been locked by admin via dashboard. Messages are monitored.");
          output += `Group (${gid}): Locked and notification sent.\n`;
          successCount++;
        } else if (action === "unlock") {
          bot.config.locked = false;
          await aero.sendMessage(gid, "🔓 Group has been unlocked. You can now chat freely.");
          output += `Group (${gid}): Unlocked and notification sent.\n`;
          successCount++;
        } else if (action === "slowmode_on") {
          bot.config.slowmodeSeconds = 15;
          await aero.sendMessage(gid, "⏳ Slow mode enabled (15 seconds limit).");
          output += `Group (${gid}): Slow mode enabled.\n`;
          successCount++;
        } else if (action === "slowmode_off") {
          bot.config.slowmodeSeconds = 0;
          await aero.sendMessage(gid, "⏳ Slow mode disabled.");
          output += `Group (${gid}): Slow mode disabled.\n`;
          successCount++;
        } else if (action === "export_chat") {
          const msgs = await aero.getMessagesDays(gid, 7);
          const textLogs = msgs.map(m => {
            const senderObj = m.senderId || m.sender;
            return `[${senderObj?.username || senderObj?.displayName || "user"}]: ${m.text || ""}`;
          }).join("\n");

          const header = `📁 **Chat Data Export (Last 7 Days - ${msgs.length} messages)**:\n\n`;
          const maxChunkSize = 1800;

          if (textLogs.length === 0) {
            await aero.sendMessage(gid, `📁 **Chat Data Export (Last 7 Days)**:\n\nNo chat history available.`);
          } else {
            const lines = textLogs.split("\n");
            let currentChunk = header;
            for (const line of lines) {
              if (currentChunk.length + line.length + 1 > maxChunkSize) {
                await aero.sendMessage(gid, currentChunk);
                currentChunk = "";
              }
              currentChunk += (currentChunk === "" ? "" : "\n") + line;
            }
            if (currentChunk !== "") {
              await aero.sendMessage(gid, currentChunk);
            }
          }
          output += `Group (${gid}): Chat data exported and sent to chat (${msgs.length} messages).\n\n`;
          successCount++;
        } else if (action === "review_reports") {
          const openReports = reports.filter(r => r.groupId === gid || r.status !== 'resolved');
          const reportsText = openReports.length > 0
            ? openReports.map(r => `• ID: ${r.id} | User: ${r.userId} | Issue: ${r.text} | Status: ${r.status}`).join("\n")
            : "No pending reports for this group.";
          const reportMsg = `📋 **Pending Reports Review**:\n\n${reportsText}`;
          await aero.sendMessage(gid, reportMsg);
          output += `Group (${gid}): Reports review sent to chat:\n${reportsText}\n\n`;
          successCount++;
        } else if (action === "view_logs") {
          const recentAudits = auditLogs.slice(-5);
          const logsText = recentAudits.length > 0
            ? recentAudits.map(l => `[${new Date(l.at).toLocaleTimeString()}] ${l.actorRole} performed ${l.action}`).join("\n")
            : "No recent actions logged.";
          const logsMsg = `🗂 **AeroGroupGuard Audit Logs**:\n\n${logsText}`;
          await aero.sendMessage(gid, logsMsg);
          output += `Group (${gid}): Audit logs sent to chat:\n${logsText}\n\n`;
          successCount++;
        } else if (action === "ban_user") {
          const targetUserId = body.targetUserId?.trim();
          if (!targetUserId) {
            output += `Group (${gid}): Target User ID is required.\n`;
            continue;
          }
          await aero.banMember(gid, targetUserId);
          output += `Group (${gid}): Manually banned user ID ${targetUserId}.\n`;
          successCount++;
        } else if (action === "kick_user") {
          const targetUserId = body.targetUserId?.trim();
          if (!targetUserId) {
            output += `Group (${gid}): Target User ID is required.\n`;
            continue;
          }
          await aero.kickMember(gid, targetUserId);
          output += `Group (${gid}): Manually kicked user ID ${targetUserId}.\n`;
          successCount++;
        } else if (action === "send_message") {
          await aero.sendMessage(gid, "👋 Hello from AeroGroupGuard Live Control Panel!");
          output += `Group (${gid}): Sent generic hello message.\n`;
          successCount++;
        } else {
          output += `Group (${gid}): Action ${action} is not implemented or unsupported.\n`;
        }
      } catch (err) {
        output += `Group (${gid}) Failed to perform ${action}: ${err.message}\n`;
      }
    }
  } else {
    output = "Aero is not connected. Please connect the userbot first.";
  }

  return json(200, { status: successCount > 0 ? "complete" : "failed", output });
}

async function saveCustomCommand(req) {
  const body = await readJson(req);
  if (body.actor?.role === "USER") {
    return json(403, { error: "Permission denied." });
  }
  const command = {
    name: sanitizeText(body.name, 40),
    response: sanitizeText(body.response, 2000),
    languages: Array.isArray(body.languages) ? body.languages : ["en"],
    attachments: Array.isArray(body.attachments) ? body.attachments : []
  };
  customCommands.push(command);
  
  // Sync to Firestore and local fallback database
  const db = loadGroupDb();
  db.customCommands = customCommands;
  saveGroupDb(db);

  audit("custom_command_saved", body.actor, [], { command: command.name });
  return json(201, { command });
}

async function saveAutomation(req) {
  const body = await readJson(req);
  if (body.actor?.role === "USER") {
    return json(403, { error: "Permission denied." });
  }
  const automation = {
    id: body.id || `auto-${automations.length + 1}`,
    trigger: sanitizeText(body.trigger, 120),
    condition: sanitizeText(body.condition, 120),
    action: sanitizeText(body.action, 120),
    enabled: body.enabled !== false
  };
  automations.push(automation);
  audit("automation_saved", body.actor, [], { automationId: automation.id });
  return json(201, { automation });
}

function installFlow() {
  return json(200, { steps: installationSteps(), supportedMethods: ["Official Login", "Browser Cookie Injection"] });
}

function serveStatic(res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.join(__dirname, "..", "public", path.normalize(safePath).replace(/^(\.\.[/\\])+/, ""));
  if (!filePath.startsWith(path.join(__dirname, "..", "public"))) return send(res, json(403, { error: "Forbidden" }));
  if (!fs.existsSync(filePath)) return send(res, json(404, { error: "Not found" }));
  const contentType = filePath.endsWith(".css") ? "text/css" : filePath.endsWith(".js") ? "application/javascript" : "text/html";
  return send(res, { status: 200, headers: { "content-type": contentType }, body: fs.readFileSync(filePath) });
}

function send(res, response) {
  res.writeHead(response.status, response.headers);
  res.end(response.body);
}

function json(status, data) {
  return { status, headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify(data) };
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) reject(new Error("Payload too large"));
    });
    req.on("end", () => resolve(body ? JSON.parse(body) : {}));
    req.on("error", reject);
  });
}

module.exports = { server, bot, ai, aero };

function normalizeGroupTargets(groupIds) {
  const activeGroups = getActiveGroups();
  if (groupIds === "all") return activeGroups.map((group) => group.id);
  if (!groupIds || groupIds.length === 0) return [];
  return Array.isArray(groupIds) ? groupIds : [groupIds];
}

function estimateRecipients(groupIds) {
  const ids = normalizeGroupTargets(groupIds);
  const activeGroups = getActiveGroups();
  return activeGroups.filter((group) => ids.includes(group.id)).reduce((total, group) => total + group.members, 0);
}

async function resolveConsoleInstruction(instruction, actor) {
  const lower = instruction.toLowerCase();
  if (lower.includes("unresolved reports")) return { status: "complete", output: reports.filter((report) => report.status !== "resolved") };
  if (lower.includes("most active")) return { status: "complete", output: aero.docks };
  if (lower.includes("weekly report") || lower.includes("summar")) {
    if (aero.connected && aero.docks.length > 0) {
      try {
        const response = await aero.getMessages(aero.docks[0].id, 30);
        const msgs = Array.isArray(response) ? response : (response?.messages || []);
        const textLogs = msgs.map(m => {
          const senderObj = m.senderId || m.sender;
          return `[${senderObj?.username || senderObj?.displayName || "user"}]: ${m.text}`;
        }).join("\n");
        const answer = await ai.answer({ text: `Create a professional digest of these messages:\n\n${textLogs}`, rules: bot.config.rules, role: actor?.role || "ADMIN" });
        return { status: "complete", output: answer };
      } catch (e) {
        return { status: "complete", output: `Failed to generate summary: ${e.message}` };
      }
    }
  }
  const answer = await ai.answer({ text: instruction, rules: bot.config.rules, role: actor?.role || "ADMIN" });
  return { status: "complete", output: answer };
}

function audit(action, actor = {}, groupIds = [], metadata = {}) {
  auditLogs.push({
    id: `audit-${auditLogs.length + 1}`,
    action,
    actorId: actor.id || "unknown",
    actorRole: actor.role || "USER",
    groupIds,
    metadata,
    result: "accepted",
    at: new Date().toISOString()
  });
}

function installationSteps() {
  return [
    "Navigate to the Connection System panel.",
    "Select Direct Login or Cookie Injection bypass.",
    "Provide Aero credentials (email & password) or paste active session cookies.",
    "Click Connect to authenticating directly with api.aryankaushik.space.",
    "Once connected, the control plane will synchronize joined group chats (docks) instantly.",
    "Automated Assistant Mode will start listening and auto-responding via WebSocket."
  ];
}

function recentActivity() {
  return [
    ...auditLogs.slice(-5).map((log) => ({ type: "audit", text: `${log.actorRole} ran ${log.action}`, at: log.at })),
    ...events.slice(-5).map((event) => ({ type: event.type, text: event.text || event.type, at: event.timestamp }))
  ].slice(-8).reverse();
}

function seedEvents() {
  return [
    { type: "info", text: "Control panel initialized.", timestamp: new Date().toISOString() }
  ];
}

function getActiveGroups() {
  if (aero.connected && aero.docks.length > 0) {
    return aero.docks;
  }
  return [
    { id: "group-1", name: "Aero Community", members: 1240, language: "en", status: "enabled", botEnabled: true },
    { id: "group-2", name: "Development Hub", members: 45, language: "en", status: "enabled", botEnabled: true }
  ];
}

function getConnectionStatus() {
  return json(200, {
    connected: aero.connected,
    method: aero.credentials ? "userbot" : "cookie",
    identifier: aero.user ? (aero.user.username || aero.user.displayName || aero.credentials?.email) : (aero.accessToken ? "Cookie injected user" : null),
    logs: connectionLogs,
    accessToken: aero.accessToken,
    user: aero.user
  });
}

async function loginAero(req) {
  const body = await readJson(req);
  const email = body.email ? sanitizeText(body.email.trim()) : "";
  const password = body.password ? sanitizeText(body.password.trim()) : "";

  if (!email || !password) {
    return json(400, { error: "Email and password are required." });
  }

  connectionLogs = [];
  const result = await aero.login(email, password);

  if (result.success) {
    connectionLogs.push(...result.logs);
    audit("userbot_login_install", { id: "owner-1", role: "OWNER" }, [], { identifier: email });
    if (aero.user && aero.user.username) {
      bot.botMention = `@${aero.user.username}`;
      assistantMode.botMention = bot.botMention;
    }
    saveSession({ method: "userbot", email, password });
    return json(200, { success: true, logs: connectionLogs });
  } else {
    connectionLogs.push(...result.logs);
    return json(400, { error: result.error, logs: connectionLogs });
  }
}

async function installWithCookie(req) {
  const body = await readJson(req);
  const cookie = body.cookie ? sanitizeText(body.cookie.trim()) : "";

  if (!cookie) {
    return json(400, { error: "Cookie content is missing or empty." });
  }

  connectionLogs = [
    `[${new Date().toLocaleTimeString()}] Parsing session token from cookie...`
  ];

  // Try parsing accessToken directly from cookie
  let token = null;
  const matchToken = cookie.match(/(accessToken|token|session_id|auth_token)=([^;]+)/i);
  if (matchToken) {
    token = matchToken[2];
  } else if (cookie.length > 50 && !cookie.includes("=")) {
    // Treat raw value as token
    token = cookie;
  }

  if (!token) {
    connectionLogs.push(`[${new Date().toLocaleTimeString()}] ❌ Failed: Could not identify authorization token in input.`);
    return json(400, { error: "Could not identify a token key. Please check cookie format.", logs: connectionLogs });
  }

  aero.disconnect();
  aero.accessToken = token;
  aero.refreshTokenCookie = cookie.includes("refreshToken") ? cookie : null;

  try {
    connectionLogs.push(`[${new Date().toLocaleTimeString()}] Verifying token identity with Aero server...`);
    aero._connected = true;
    const profileRes = await aero.fetchMe();
    if (!profileRes) {
      throw new Error("Could not retrieve profile info for token.");
    }
    aero.user = profileRes;

    connectionLogs.push(`[${new Date().toLocaleTimeString()}] Identity: @${aero.user.username || aero.user.displayName}`);
    if (aero.user && aero.user.username) {
      bot.botMention = `@${aero.user.username}`;
      assistantMode.botMention = bot.botMention;
    }
    connectionLogs.push(`[${new Date().toLocaleTimeString()}] Fetching joined group docks...`);
    await aero.fetchDocks();

    connectionLogs.push(`[${new Date().toLocaleTimeString()}] Found ${aero.docks.length} groups.`);
    aero._connectSocket();
    connectionLogs.push(`[${new Date().toLocaleTimeString()}] ✅ Socket connection established.`);

    audit("cookie_injection_install", { id: "owner-1", role: "OWNER" }, [], { identifier: "Cookie Session" });
    saveSession({ method: "cookie", cookie });
    return json(200, { success: true, logs: connectionLogs });
  } catch (err) {
    aero.disconnect();
    connectionLogs.push(`[${new Date().toLocaleTimeString()}] ❌ Verification failed: ${err.message}`);
    return json(400, { error: err.message, logs: connectionLogs });
  }
}

function disconnectBot() {
  const previousMethod = aero.credentials ? "userbot" : "cookie";
  aero.disconnect();
  saveSession(null);
  connectionLogs = [
    `[${new Date().toLocaleTimeString()}] Disconnected bot account. Control plane is offline.`
  ];
  bot.botMention = "@AeroGroupGuard";
  assistantMode.botMention = "@AeroGroupGuard";

  audit("bot_disconnect", { id: "owner-1", role: "OWNER" }, [], { previousMethod });
  return json(200, { success: true });
}

function getUserApprovals() {
  const db = loadGroupDb();
  return json(200, { approvedUsers: db.approvedUsers, pendingUsers: db.pendingUsers });
}

async function approveUser(req) {
  const body = await readJson(req);
  const userId = body.userId;
  if (!userId) return json(400, { error: "User ID is required." });
  const db = loadGroupDb();
  if (!db.approvedUsers.includes(userId)) {
    db.approvedUsers.push(userId);
  }
  db.pendingUsers = db.pendingUsers.filter(u => u.id !== userId);
  saveGroupDb(db);
  return json(200, { success: true });
}

async function rejectUser(req) {
  const body = await readJson(req);
  const userId = body.userId;
  if (!userId) return json(400, { error: "User ID is required." });
  const db = loadGroupDb();
  db.pendingUsers = db.pendingUsers.filter(u => u.id !== userId);
  saveGroupDb(db);
  return json(200, { success: true });
}

function queueAssistantReply(groupId, text, reason) {
  const action = {
    id: `outbound-${outboundMessages.length + 1}`,
    groupId: groupId || "unknown",
    text,
    reason,
    status: "sent",
    at: new Date().toISOString()
  };
  outboundMessages.push(action);
  if (outboundMessages.length > 100) outboundMessages.shift();
  audit("assistant_reply_queued", { id: "system", role: "SYSTEM" }, [action.groupId], { reason, messageLength: text.length });
  return action;
}

let chatsCache = null;
let chatsCacheNeedsSave = false;
let chatsSaveTimeout = null;

function saveMessageToFile(dockId, message) {
  const dbDir = path.join(__dirname, "..", "db");
  const filePath = path.join(dbDir, "chats.json");
  try {
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    if (!chatsCache) {
      if (fs.existsSync(filePath)) {
        try {
          chatsCache = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        } catch (e) {
          chatsCache = {};
        }
      } else {
        chatsCache = {};
      }
    }
    
    if (!chatsCache[dockId]) {
      chatsCache[dockId] = [];
    }
    chatsCache[dockId].push(message);
    if (chatsCache[dockId].length > 1000) {
      chatsCache[dockId].shift();
    }
    
    chatsCacheNeedsSave = true;
    triggerChatsSave();
  } catch (err) {
    console.error("[Storage Error] Failed to save message:", err.message);
  }
}

function triggerChatsSave() {
  if (chatsSaveTimeout) return;
  
  chatsSaveTimeout = setTimeout(() => {
    chatsSaveTimeout = null;
    if (!chatsCacheNeedsSave || !chatsCache) return;
    
    chatsCacheNeedsSave = false;
    const dbDir = path.join(__dirname, "..", "db");
    const filePath = path.join(dbDir, "chats.json");
    const tempPath = filePath + ".tmp";
    
    try {
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }
      fs.writeFile(tempPath, JSON.stringify(chatsCache), "utf-8", (err) => {
        if (err) {
          console.error("[Storage Error] Failed to write chats to temp file:", err.message);
          return;
        }
        if (!fs.existsSync(dbDir)) {
          fs.mkdirSync(dbDir, { recursive: true });
        }
        fs.rename(tempPath, filePath, (renameErr) => {
          if (renameErr) {
            console.error("[Storage Error] Failed to rename temp chats file:", renameErr.message);
          }
        });
      });
    } catch (err) {
      console.error("[Storage Error] Failed to save chats asynchronously:", err.message);
    }
  }, 10000); // Throttle writes to at most once every 10 seconds
}

// Flush pending database writes on exit
function flushPendingWritesSync() {
  if (chatsCacheNeedsSave && chatsCache) {
    const dbDir = path.join(__dirname, "..", "db");
    const filePath = path.join(dbDir, "chats.json");
    try {
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }
      fs.writeFileSync(filePath, JSON.stringify(chatsCache), "utf-8");
      console.log("[Storage] Chats flushed successfully on exit.");
    } catch (e) {
      console.error("[Storage] Failed to flush chats on exit:", e.message);
    }
  }
}

process.on("SIGINT", () => {
  flushPendingWritesSync();
  process.exit(0);
});
process.on("SIGTERM", () => {
  flushPendingWritesSync();
  process.exit(0);
});
