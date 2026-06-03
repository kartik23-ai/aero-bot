"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
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

// Initialize Firebase connection if key exists
let firestoreDb = null;
let groupDbCache = null;
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
  }
  return groupDbCache;
}

function saveGroupDb(data) {
  groupDbCache = data;
  const dbPath = path.join(__dirname, "..", "db", "group_database.json");
  try {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), "utf-8");
  } catch (e) {
    console.error("Failed to write local backup database:", e.message);
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
      warnings: {}
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
  return g;
}

// Session Persistence Bypasses
function saveSession(sessionData) {
  const sessionPath = path.join(__dirname, "..", "db", "session.json");
  try {
    if (sessionData === null) {
      if (fs.existsSync(sessionPath)) fs.unlinkSync(sessionPath);
    } else {
      fs.writeFileSync(sessionPath, JSON.stringify(sessionData, null, 2), "utf-8");
    }
  } catch (e) {
    console.error("Failed to save session:", e.message);
  }
}

function loadSession() {
  const sessionPath = path.join(__dirname, "..", "db", "session.json");
  try {
    if (fs.existsSync(sessionPath)) {
      return JSON.parse(fs.readFileSync(sessionPath, "utf-8"));
    }
  } catch (e) {
    console.error("Failed to load session:", e.message);
  }
  return null;
}

async function autoConnect() {
  const session = loadSession();
  if (!session) {
    console.log("[AutoConnect] No saved session found.");
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

// Socket Message Listener
aero.onMessage(async (msg) => {
  const senderObj = msg.senderId || msg.sender;
  const botUserId = aero.user?._id || aero.user?.id;
  
  if (senderObj && botUserId && (senderObj._id === botUserId || senderObj.id === botUserId)) {
    return;
  }

  const senderId = senderObj?._id || senderObj?.id || "unknown";
  const senderName = senderObj?.username || senderObj?.displayName || "User";
  const text = msg.text || "";
  const dockId = msg.dockId;

  console.log(`[SocketMessage] Received from ${senderName} (${senderId}) in dock ${dockId}: ${text}`);

  // Load database
  const db = loadGroupDb();

  // Whitelist/Approvals check
  const isBotOrOwner = senderId === "owner-1" || (botUserId && senderId === botUserId);
  if (!isBotOrOwner && !db.approvedUsers.includes(senderId)) {
    const targetDock = aero.docks.find(d => d.id === dockId);
    const isGroup = targetDock && (targetDock.type === "group" || targetDock.members > 2);

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

  const targetDock = aero.docks.find(d => d.id === dockId);
  const groupName = targetDock ? targetDock.name : "Aero Group";
  // Determine if it is a Group or DM (Direct Message)
  const isGroup = targetDock && (targetDock.type === "group" || targetDock.members > 2);

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
        const joinRes = await aero.joinDock(inviteCode);
        const newDockId = joinRes?.dock?._id || joinRes?.dock?.id || joinRes?._id || joinRes?.id;
        const joinedDockName = joinRes?.dock?.name || "Aero Group";

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
          language: "en"
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

  // Fetch group members to check roles
  let adminIds = [];
  let isSenderOwner = false;
  let isSenderAdmin = false;
  
  try {
    const membersRes = await aero.getMembers(dockId);
    const members = Array.isArray(membersRes) ? membersRes : (membersRes?.members || []);
    
    adminIds = members
      .filter(m => m.isAdmin || m.role === "admin" || m.role === "owner")
      .map(m => m.user?._id || m.user?.id)
      .filter(Boolean);

    const memberObj = members.find(m => {
      const uid = m.user?._id || m.user?.id;
      return uid === senderId;
    });

    if (memberObj) {
      isSenderOwner = memberObj.role === "owner";
      isSenderAdmin = memberObj.role === "admin" || memberObj.isAdmin === true || isSenderOwner;
    }
  } catch (err) {
    console.error("[Enforcer] Failed to fetch group members:", err.message);
  }

  // Treat owner-1 as overall owner
  if (senderId === "owner-1") {
    isSenderOwner = true;
    isSenderAdmin = true;
  }

  const canEdit = isSenderOwner || isSenderAdmin;

  // Fetch chat history for summaries
  let chatHistory = [];
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

  const botMentionText = bot.botMention.toLowerCase();
  const lowerText = text.toLowerCase();
  const isMention = lowerText.includes(botMentionText);

  const context = {
    enabled: assistantMode.enabled,
    isGroup,
    groupName,
    adminIds,
    chatHistory,
    assistantOnly: assistantMode.nonDestructiveOnly
  };

  const parsedCmd = bot.parseCommand(text);

  // 1. Lock Enforcement (Only non-admins are blocked, but check if message is a command first)
  if (groupSettings.locked && !isSenderAdmin) {
    try {
      await aero.sendMessage(dockId, `⚠️ @${senderName}, chat is currently locked by admin.`);
      return;
    } catch (err) {
      console.error("[Enforcer] Lock warning failed:", err.message);
    }
  }

  // 2. Slowmode Enforcement (Only non-admins)
  if (groupSettings.slowmodeSeconds > 0 && !isSenderAdmin) {
    const now = Date.now();
    const lastTimeKey = `${dockId}:${senderId}`;
    const lastTime = lastMessageTime.get(lastTimeKey) || 0;
    const diff = (now - lastTime) / 1000;
    if (diff < groupSettings.slowmodeSeconds) {
      const waitTime = Math.ceil(groupSettings.slowmodeSeconds - diff);
      try {
        await aero.sendMessage(dockId, `⏳ @${senderName}, please wait ${waitTime}s before sending another message.`);
        return;
      } catch (err) {
        console.error("[Enforcer] Slowmode warning failed:", err.message);
      }
    }
    lastMessageTime.set(lastTimeKey, now);
  }

  // 3. Abusive Word Filter
  if (groupSettings.abusiveFilter && !isSenderAdmin) {
    const localAbusiveRegex = /\b(mc|bc|bhenchod|bhenchodd|madarchod|chutiya|chutiye|lund|gandu|saala|harami|bkl|mkl|kuta|kutta|chut|randi|suar|kamine|gaali)\b/i;
    let isAbusiveMsg = localAbusiveRegex.test(text);

    if (!isAbusiveMsg && ai.enabled && ai.groq) {
      try {
        const aiCheck = await ai.groq.chat.completions.create({
          messages: [
            {
              role: "system",
              content: "You are a content moderation assistant. Check if the user message contains any English, Hindi, or Hinglish slurs, profanity, abusive terms, sexual terms, vulgar expressions, short form gaalis (like bc, mc, bkl, etc.) or harassment. Reply with EXACTLY 'ABUSIVE' or 'SAFE'. Do not reply with anything else."
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
          isAbusiveMsg = true;
        }
      } catch (e) {
        console.error("[Abusive Filter AI Error]:", e.message);
      }
    }

    if (isAbusiveMsg) {
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
  }

  // --- Process commands using the per-group database ---
  let reply = null;

  if (parsedCmd) {
    const cmdName = parsedCmd.name;
    const argsText = parsedCmd.argsText || "";

    if (["setrules", "slowmode", "slow5", "slowmode5", "slow10", "slowmode10", "lock", "lockgroup", "unlock", "unlockgroup", "abusive", "toggleadmin", "warn", "clearwarns"].includes(cmdName)) {
      if (["setrules", "slowmode", "slow5", "slowmode5", "slow10", "slowmode10", "lock", "lockgroup", "unlock", "unlockgroup", "abusive"].includes(cmdName)) {
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
            const membersRes = await aero.getMembers(dockId);
            const members = Array.isArray(membersRes) ? membersRes : (membersRes?.members || []);
            const targetMember = members.find(m => m.user?.username?.toLowerCase() === targetUsername);

            if (!targetMember) {
              reply = `❌ User @${targetUsername} not found in this group.`;
            } else {
              const targetId = targetMember.user?._id || targetMember.user?.id;
              if (cmdName === "warn") {
                const reason = parts.slice(1).join(" ") || "No reason provided.";
                if (!groupSettings.warnings[targetId]) {
                  groupSettings.warnings[targetId] = 0;
                }
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
    } else if (cmdName === "status") {
      reply = `Group Status: Rules: ${groupSettings.rules.substring(0, 30)}..., Lock: ${groupSettings.locked ? "locked" : "unlocked"}, Slowmode: ${groupSettings.slowmodeSeconds > 0 ? groupSettings.slowmodeSeconds + "s" : "disabled"}, Abusive filter: ${groupSettings.abusiveFilter ? "enabled" : "disabled"}, Admins allowed to edit: ${groupSettings.allowAdminsToEdit ? "yes" : "no"}, Warnings logged: ${Object.keys(groupSettings.warnings).length}`;
    } else if (cmdName === "report") {
      const reason = argsText || "No reason provided.";
      const reportId = `report-${reports.length + 1}`;
      reports.push({
        id: reportId,
        groupId: dockId,
        userId: senderId,
        text: reason,
        status: "open",
        createdAt: new Date().toISOString()
      });
      reply = "Report received. An admin will review this.";
      console.log(`[Reports] New report filed in chat: ${reportId} for user ${senderId} in dock ${dockId}`);
    } else if (["admin", "admins"].includes(cmdName)) {
      if (!isGroup) {
        reply = "❌ This command can only be used inside group chats.";
      } else {
        try {
          const membersRes = await aero.getMembers(dockId);
          const members = Array.isArray(membersRes) ? membersRes : (membersRes?.members || []);
          
          const ownerMember = members.find(m => m.role === "owner" || m.role === "creator");
          const adminMembers = members.filter(m => (m.role === "admin" || m.isAdmin === true) && m.role !== "owner" && m.role !== "creator");
          
          let ownerText = "";
          if (ownerMember) {
            ownerText = `👑 Owner: @${ownerMember.user?.username || ownerMember.user?.fullName || "Unknown"}\n`;
          } else {
            ownerText = `👑 Owner: Not found\n`;
          }
          
          let adminsText = "";
          if (adminMembers.length > 0) {
            adminsText = `👮 Admins:\n` + adminMembers.map(m => `• @${m.user?.username || m.user?.fullName || "Admin"}`).join("\n");
          } else {
            adminsText = `👮 Admins: None`;
          }
          
          reply = `📋 **Group Administration**\n\n${ownerText}\n${adminsText}`;
        } catch (err) {
          console.error("[Admins Command Error]:", err.message);
          reply = `❌ Failed to fetch admins list: ${err.message}`;
        }
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
          const textLogs = recentMsgs.map(m => m.text).join("\n");
          if (ai.enabled && ai.groq) {
            try {
              const summary = await ai.answer({
                text: `Please generate a beautiful, concise summary of the last 24 hours of chat logs. Highlight key topics discussed, decisions made, and pending tasks in bullet points:\n\n${textLogs}`,
                rules: groupSettings.rules,
                role: "ADMIN",
                language: "en"
              });
              reply = `📝 **AeroGroupGuard AI 1-Day Chat Summary**:\n\n${summary}`;
            } catch (err) {
              console.error("[AI Summary Command Error]:", err.message);
              reply = bot.handleMessage({ text, sender: { id: senderId } }, { ...context, adminIds });
            }
          } else {
            reply = bot.handleMessage({ text, sender: { id: senderId } }, { ...context, adminIds });
          }
        }
      }
    } else {
      reply = bot.handleMessage({ text, sender: { id: senderId } }, { ...context, adminIds });
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
          language: "en"
        });
      } catch (err) {
        console.error("[AI] Error generating answer:", err.message);
        reply = "Sorry, I encountered an issue processing that query.";
      }
    } else {
      reply = "Haan ji? Boliye, main aapki kya madad kar sakta hoon?";
    }
  } else {
    reply = bot.handleMessage({ text, sender: { id: senderId } }, { ...context, adminIds });
  }

  if (reply) {
    try {
      console.log(`[AutoReply] Sending to dock ${dockId}: ${reply}`);
      await aero.sendMessage(dockId, reply);
      queueAssistantReply(dockId, reply, isMention ? "mention_reply" : "command_reply");
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
        } else {
          console.log("[Firestore] No database found in cloud, will create one on first write.");
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
  const context = {
    enabled: body.enabled !== false,
    isGroup: true,
    groupName: body.groupName,
    adminIds: body.adminIds || [],
    chatHistory: body.chatHistory || [],
    assistantOnly: assistantMode.nonDestructiveOnly
  };

  if (eventType === "member_join") {
    const welcome = assistantMode.autoWelcome ? bot.handleMemberJoin(sender, context) : null;
    return json(200, {
      eventType,
      reply: welcome,
      sendAction: { status: "queued_for_auto_send", reason: "welcome" }
    });
  }

  if (eventType === "message" || eventType === "newMessage") {
    const botMentionText = bot.botMention.toLowerCase();
    const lowerText = (text || "").toLowerCase();
    const isMention = lowerText.includes(botMentionText);
    const parsedCmd = bot.parseCommand(text || "");

    let reply = null;

    if (isMention && !parsedCmd) {
      const escapedMention = bot.botMention.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const mentionRegex = new RegExp(escapedMention, "gi");
      const question = (text || "").replace(mentionRegex, "").replace(/\s+/g, " ").trim();

      if (question) {
        try {
          reply = await ai.answer({
            text: question,
            rules: bot.config.rules,
            role: "USER",
            language: "en"
          });
        } catch (err) {
          reply = "Sorry, I encountered an issue processing that query.";
        }
      } else {
        reply = "Haan ji? Boliye, main aapki kya madad kar sakta hoon?";
      }
    } else {
      reply = bot.handleMessage({ text, sender: { id: sender.id || sender._id || "unknown" } }, context);
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
    language: body.language
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
  const message = sanitizeText(body.message, 2000);
  
  let sent = 0;
  let failed = 0;

  if (aero.connected) {
    for (const gid of groupIds) {
      try {
        await aero.sendMessage(gid, message);
        sent++;
      } catch (err) {
        console.error(`Failed to send message to group ${gid}:`, err.message);
        failed++;
      }
    }
  }

  const result = { sent, failed, groups: groupIds };
  audit("manual_message_sent", body.actor, groupIds, { messageLength: message.length, result });
  events.push({ type: "manual_message", userId: body.actor?.id, text: `[Dashboard Broadcast]: ${message}`, timestamp: new Date().toISOString() });
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

          const textLogs = msgs.map(m => {
            const senderObj = m.senderId || m.sender;
            return `[${senderObj?.username || senderObj?.displayName || "user"}]: ${m.text}`;
          }).join("\n");

          const summary = await ai.answer({
            text: `Please generate a beautiful, concise summary of the last 24 hours of chat logs. Highlight key topics discussed, decisions made, and pending tasks in bullet points:\n\n${textLogs}`,
            rules: "Highlight key topics, decisions, and tasks from the chat history. Avoid mentioning bots or list of bot commands unless they were a major topic. Return key points only.",
            role: "ADMIN",
            language: "en"
          });
          const summaryText = `📝 **AeroGroupGuard AI 1-Day Chat Summary**:\n\n${summary}`;
          await aero.sendMessage(gid, summaryText);
          output += `Group (${gid}): Summary generated and sent to chat:\n${summary}\n\n`;
          successCount++;
        } else if (action === "mention_everyone") {
          const members = await aero.getMembers(gid);
          let mentionsList = [];
          if (Array.isArray(members)) {
            mentionsList = members.map(m => m.username || m.user?.username || m.displayName || m.user?.displayName).filter(Boolean);
          } else if (members && Array.isArray(members.members)) {
            mentionsList = members.members.map(m => m.username || m.user?.username || m.displayName || m.user?.displayName).filter(Boolean);
          }
          const mentionMsg = mentionsList.length > 0
            ? `📢 @everyone Attention!\n\nMentions: ${mentionsList.map(name => `@${name}`).join(" ")}`
            : `📢 @everyone Attention! (No members found)`;
          await aero.sendMessage(gid, mentionMsg);
          output += `Group (${gid}): Mention everyone sent to chat.\n`;
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

module.exports = { server, bot, ai };

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

function saveMessageToFile(dockId, message) {
  const dbDir = path.join(__dirname, "..", "db");
  const filePath = path.join(dbDir, "chats.json");
  try {
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    let data = {};
    if (fs.existsSync(filePath)) {
      try {
        data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      } catch (e) {
        data = {};
      }
    }
    if (!data[dockId]) {
      data[dockId] = [];
    }
    data[dockId].push(message);
    if (data[dockId].length > 1000) {
      data[dockId].shift();
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error("[Storage Error] Failed to save message:", err.message);
  }
}
