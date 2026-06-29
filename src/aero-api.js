"use strict";

const axios = require("axios");
const { config } = require("./config");

const API_BASE = "https://api.aryankaushik.space/api";
const SOCKET_BASE = "https://api.aryankaushik.space";

class AeroAPI {
  constructor() {
    this.accessToken = null;
    this.refreshTokenCookie = null;
    this.credentials = null;
    this.user = null;
    this.docks = [];
    this.socket = null;
    this.messageListeners = [];
    this.messageSentListeners = [];
    this.taskStatusListeners = [];
    this._refreshTimer = null;
    this._connected = false;
    this._membersCache = new Map();
    this._pendingMembers = new Map();
    this._lastTokenRefreshTime = 0;
    this._messageQueue = [];
    this._processingQueue = false;
    this._lastMessageSentTime = 0;
    this._sentMessageTimestamps = [];
  }

  get connected() {
    return this._connected && !!this.accessToken;
  }

  /**
   * Login with email + password to real Aero API
   */
  async login(email, password) {
    const logs = [];
    logs.push(`[${ts()}] Connecting to Aero Messenger API...`);
    logs.push(`[${ts()}] Endpoint: ${API_BASE}/auth/login`);

    try {
      const res = await axios.post(`${API_BASE}/auth/login`, {
        identifier: email,
        password: password
      }, {
        withCredentials: true,
        // capture set-cookie headers
        validateStatus: () => true
      });

      if (res.status !== 200 && res.status !== 201) {
        const errMsg = res.data?.message || res.data?.error || `HTTP ${res.status}`;
        logs.push(`[${ts()}] ❌ Login failed: ${errMsg}`);
        return { success: false, logs, error: errMsg };
      }

      this.accessToken = res.data.accessToken || res.data.token;
      this.credentials = { email, password };

      // Extract refresh token cookie if present
      const setCookies = res.headers["set-cookie"] || [];
      for (const c of setCookies) {
        if (c.includes("refreshToken")) {
          this.refreshTokenCookie = c;
        }
      }

      logs.push(`[${ts()}] ✅ Authentication successful!`);
      logs.push(`[${ts()}] Access token received (${this.accessToken.substring(0, 20)}...)`);

      // Fetch user profile
      try {
        logs.push(`[${ts()}] Fetching user profile identity...`);
        const profile = await this.fetchMe();
        if (profile) {
          logs.push(`[${ts()}] 👤 Logged in as: @${profile.username || profile.fullName || email}`);
        } else {
          logs.push(`[${ts()}] ⚠ Profile fetch failed, using default session.`);
        }
      } catch (e) {
        logs.push(`[${ts()}] ⚠ Profile fetch failed: ${e.message}`);
      }

      // Fetch docks (groups)
      logs.push(`[${ts()}] Fetching joined docks (groups)...`);
      await this.fetchDocks();
      logs.push(`[${ts()}] 📋 Found ${this.docks.length} docks:`);
      for (const dock of this.docks) {
        logs.push(`[${ts()}]   • ${dock.name} (${dock.memberCount || "?"} members) — Role: ${dock.role || "member"}`);
      }

      this._connected = true;

      // Set up auto-refresh timer (every 4 minutes since token expires in ~5 min)
      this._startRefreshTimer();

      // Connect socket
      this._connectSocket();

      logs.push(`[${ts()}] 🔗 Real-time socket connected to ${SOCKET_BASE}`);
      logs.push(`[${ts()}] ✅ Bot is LIVE and connected to ${this.docks.length} real groups!`);

      return { success: true, logs };
    } catch (err) {
      logs.push(`[${ts()}] ❌ Connection error: ${err.message}`);
      return { success: false, logs, error: err.message };
    }
  }

  /**
   * Join a dock using an invite code
   */
  async joinDock(inviteCode) {
    const res = await axios.post(
      `${API_BASE}/docks/join`,
      { inviteCode },
      { headers: this._authHeaders() }
    );
    // Refresh joined docks list
    await this.fetchDocks();
    return res.data;
  }

  /**
   * Upload an audio buffer as a document to S3 using multipart upload
   */
  async uploadAudioBuffer(buffer, fileName, mimeType, destinationId, isGroup) {
    const sizeBytes = buffer.length;
    const destinationType = isGroup ? "dock" : "conversation";

    const initRes = await axios.post(
      `${API_BASE}/media/multipart/init`,
      {
        fileName,
        mimeType,
        sizeBytes,
        mediaKind: "audio",
        mode: "chat_media",
        destinationType,
        destinationId
      },
      { headers: this._authHeaders() }
    );

    const sessionId = initRes.data.sessionId;

    const urlRes = await axios.post(
      `${API_BASE}/media/multipart/part-url`,
      { sessionId, partNumber: 1 },
      { headers: this._authHeaders() }
    );

    const putRes = await axios.put(urlRes.data.url, buffer, {
      headers: { "Content-Type": mimeType }
    });
    const eTagRaw = putRes.headers["etag"] || putRes.headers["ETag"];
    const eTag = eTagRaw ? eTagRaw.replace(/"/g, "") : "";

    const completeRes = await axios.post(
      `${API_BASE}/media/multipart/complete`,
      {
        sessionId,
        parts: [
          { partNumber: 1, eTag }
        ]
      },
      { headers: this._authHeaders() }
    );

    return completeRes.data.s3Key;
  }

  /**
   * Fetch details of a single dock and update cache
   */
  async fetchDock(dockId) {
    try {
      await this.fetchDocks();
      return this.docks.find(d => d.id === dockId) || null;
    } catch (err) {
      console.error(`[AeroAPI] Failed to fetch single dock ${dockId}:`, err.message);
    }
    return null;
  }

  /**
   * Fetch all docks the user is joined to
   */
  async fetchDocks() {
    try {
      const data = await this._get("/docks/my");
      if (Array.isArray(data)) {
        this.docks = data.map(d => ({
          id: d._id || d.id,
          name: d.name,
          members: d.memberCount || d.members || 0,
          memberCount: d.memberCount || d.members || 0,
          role: d.role || "member",
          type: d.type || "group",
          icon: d.icon || null,
          language: "en",
          status: "enabled",
          botEnabled: true,
          admins: d.admins || [],
          creatorId: d.creatorId || null
        }));
      } else if (data && data.docks) {
        this.docks = data.docks.map(d => ({
          id: d._id || d.id,
          name: d.name,
          members: d.memberCount || d.members || 0,
          memberCount: d.memberCount || d.members || 0,
          role: d.role || "member",
          type: d.type || "group",
          icon: d.icon || null,
          language: "en",
          status: "enabled",
          botEnabled: true,
          admins: d.admins || [],
          creatorId: d.creatorId || null
        }));
      }
    } catch (err) {
      console.error("[AeroAPI] Failed to fetch docks:", err.message);
    }
  }

  /**
   * Fetch a single dock's complete metadata (including member list)
   */
  async getDock(dockId) {
    try {
      const data = await this._get(`/docks/${dockId}`);
      return data;
    } catch (err) {
      console.error(`[AeroAPI] Failed to fetch dock ${dockId}:`, err.message);
      return null;
    }
  }

  /**
   * Fetch a single user's profile by userId
   */
  async getUser(userId) {
    try {
      const data = await this._get(`/users/${userId}`);
      return data;
    } catch (err) {
      console.error(`[AeroAPI] Failed to fetch user ${userId}:`, err.message);
      return null;
    }
  }

  async sendMessage(dockId, text, image = null, isGroup = null, document = null, attachment = null, asVoiceNote = false) {
    let cleanText = text;
    if (typeof cleanText === "string") {
      // Remove double asterisks and single asterisks commonly used for bold/italics
      cleanText = cleanText.replace(/\*\*/g, "").replace(/\*/g, "");
    }
    return new Promise((resolve, reject) => {
      this._messageQueue.push({ dockId, text: cleanText, image, isGroup, document, attachment, asVoiceNote, resolve, reject });
      this._processQueue();
    });
  }

  async _processQueue() {
    if (this._processingQueue) return;
    if (this._messageQueue.length === 0) return;

    this._processingQueue = true;

    try {
      while (this._messageQueue.length > 0) {
        const now = Date.now();

        // 1. Sliding Window Outbound Rate Limiting
        // Remove timestamps older than 60 seconds
        this._sentMessageTimestamps = this._sentMessageTimestamps.filter(t => now - t < 60000);

        const limit = config.rateLimitPerMinute || 120;
        if (this._sentMessageTimestamps.length >= limit) {
          const oldestTimestamp = this._sentMessageTimestamps[0];
          const waitTime = 60000 - (now - oldestTimestamp);
          console.warn(`[AeroAPI] Outbound rate limit reached (${limit} msg/min). Pausing queue for ${waitTime}ms...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue; // Re-evaluate timestamps
        }

        // 2. Minimum delay between consecutive messages to avoid server spike rate limits
        const elapsed = now - this._lastMessageSentTime;
        const minDelay = 1500; // 1.5 seconds minimum delay

        if (elapsed < minDelay) {
          await new Promise(resolve => setTimeout(resolve, minDelay - elapsed));
        }

        const item = this._messageQueue.shift();
        try {
          let useGroup = item.isGroup;
          if (useGroup === null) {
            useGroup = this.docks.some(d => d.id === item.dockId);
          }
          let url;
          if (useGroup) {
            url = `${API_BASE}/docks/${item.dockId}/messages`;
          } else {
            url = `${API_BASE}/messages/send/${item.dockId}`;
          }
          const payload = { text: item.text };
          if (item.image) {
            payload.image = item.image;
          }
          if (item.document) {
            if (item.asVoiceNote) {
              payload.messageType = "voice";
              payload.voiceNote = {
                url: item.document,
                duration: 5000,
                waveform: "",
                fileSize: 0,
                mimeType: "audio/mpeg"
              };
            } else {
              payload.document = item.document;
            }
          }
          if (item.attachment) {
            payload.attachment = item.attachment;
          }
          
          console.log(`[AeroAPI] [Outbound Queue] Sending message to ${item.dockId}: "${item.text}"`);
          const res = await axios.post(
            url,
            payload,
            { headers: this._authHeaders() }
          );
          const sentTime = Date.now();
          this._lastMessageSentTime = sentTime;
          this._sentMessageTimestamps.push(sentTime);
          item.resolve(res.data);

          // Trigger message sent listeners
          if (this.messageSentListeners) {
            for (const listener of this.messageSentListeners) {
              try {
                listener({
                  dockId: item.dockId,
                  text: item.text,
                  image: item.image,
                  attachment: item.attachment,
                  document: item.document,
                  timestamp: new Date(sentTime).toISOString()
                });
              } catch (err) {
                console.error("[AeroAPI] Error in messageSentListener:", err.message);
              }
            }
          }
        } catch (err) {
          console.error(`[AeroAPI] [Outbound Queue] Failed to send message:`, err.message);
          // If it is a 429 Too Many Requests, put it back at the front and pause the queue
          if (err?.response?.status === 429) {
            this._messageQueue.unshift(item);
            console.warn("[AeroAPI] 429 Too Many Requests. Pausing queue for 5 seconds...");
            await new Promise(resolve => setTimeout(resolve, 5000));
          } else {
            item.reject(err);
          }
        }
      }
    } finally {
      this._processingQueue = false;
    }
  }

  /**
   * Kick a member from a dock
   */
  async kickMember(dockId, userId) {
    const res = await axios.post(
      `${API_BASE}/docks/${dockId}/members/${userId}/kick`,
      {},
      { headers: this._authHeaders() }
    );
    return res.data;
  }

  /**
   * Ban a member from a dock
   */
  async banMember(dockId, userId) {
    const res = await axios.post(
      `${API_BASE}/docks/${dockId}/members/${userId}/ban`,
      {},
      { headers: this._authHeaders() }
    );
    return res.data;
  }

  /**
   * Mute a member in a dock
   */
  async muteMember(dockId, userId) {
    const res = await axios.post(
      `${API_BASE}/docks/${dockId}/members/${userId}/mute`,
      {},
      { headers: this._authHeaders() }
    );
    return res.data;
  }

  /**
   * Update dock settings on the Aero Messenger server
   */
  async updateDockSettings(dockId, settings) {
    const res = await axios.put(
      `${API_BASE}/docks/${dockId}/admin/settings`,
      { settings },
      { headers: this._authHeaders() }
    );
    return res.data;
  }

  /**
   * Rename a dock on the Aero Messenger server
   */
  async renameDock(dockId, name) {
    const res = await axios.put(
      `${API_BASE}/docks/${dockId}`,
      { name },
      { headers: this._authHeaders() }
    );
    return res.data;
  }

  /**
   * Fetch messages from a dock
   */
  async getMessages(dockId, limit = 50) {
    const res = await this._get(`/docks/${dockId}/messages?limit=${limit}`);
    return Array.isArray(res) ? res : (res?.messages || []);
  }

  /**
   * Fetch all messages from a dock in the last N days (with pagination)
   */
  async getMessagesDays(dockId, days = 7) {
    const timeLimit = Date.now() - days * 24 * 60 * 60 * 1000;
    let allMessages = [];
    let beforeId = null;
    let iterations = 0;
    const maxIterations = days * 15; // More days = more pages allowed

    while (iterations < maxIterations) {
      let endpoint = `/docks/${dockId}/messages?limit=100`;
      if (beforeId) {
        endpoint += `&before=${beforeId}`;
      }
      
      try {
        const response = await this._get(endpoint);
        const msgs = Array.isArray(response) ? response : (response?.messages || []);
        
        if (msgs.length === 0) {
          break;
        }
        
        allMessages = msgs.concat(allMessages);
        
        const oldestMsg = msgs[0];
        const oldestTime = new Date(oldestMsg.createdAt || oldestMsg.updatedAt || 0).getTime();
        
        if (oldestTime < timeLimit) {
          break;
        }
        
        beforeId = oldestMsg._id || oldestMsg.id;
        iterations++;
      } catch (err) {
        console.error(`[AeroAPI] Error in getMessagesDays pagination iteration ${iterations}:`, err.message);
        break;
      }
    }
    
    return allMessages.filter(m => {
      const timestamp = new Date(m.createdAt || m.updatedAt || 0).getTime();
      return Number.isFinite(timestamp) && timestamp >= timeLimit;
    });
  }

  /**
   * Fetch all messages from a dock in the last 7 days (with pagination)
   */
  async getMessages7Days(dockId) {
    return await this.getMessagesDays(dockId, 7);
  }

  /**
   * Fetch a single member from a dock by userId.
   * Used for per-command admin checks — never fetches the full member list.
   */
  async getMember(dockId, userId) {
    try {
      const data = await this._get(`/docks/${dockId}/members/${userId}`);
      return data;
    } catch (err) {
      // 404 means user is not in this dock
      if (err?.response?.status === 404) {
        return null;
      }
      console.error(`[AeroAPI] Failed to fetch member ${userId} in dock ${dockId}:`, err.message);
      return null;
    }
  }

  /**
   * Fetch members of a dock with a 30-second caching mechanism to optimize CPU/Network
   */
  async getMembers(dockId, forceRefresh = false) {
    console.warn(`[AeroAPI] WARNING: getMembers called for dock ${dockId}. Member list downloads are fully excluded! Returning empty list.`);
    return [];
  }

  /**
   * Refresh access token
   */
  async refreshToken() {
    const now = Date.now();
    // 30 seconds cooldown throttle for token refresh to avoid spamming server during socket reconnect loops
    if (now - this._lastTokenRefreshTime < 30000) {
      console.log("[AeroAPI] Token refresh request throttled (30s cooldown).");
      return false;
    }
    this._lastTokenRefreshTime = now;

    try {
      let refreshed = false;
      // First try refresh endpoint
      const headers = {};
      if (this.refreshTokenCookie) {
        headers["Cookie"] = this.refreshTokenCookie;
      }
      const res = await axios.post(`${API_BASE}/auth/refresh`, {}, {
        headers,
        validateStatus: () => true
      });

      if (res.status === 200 && res.data.accessToken) {
        this.accessToken = res.data.accessToken;
        console.log(`[AeroAPI] Token refreshed at ${ts()}`);
        refreshed = true;
      } else if (this.credentials) {
        // If refresh fails, re-login with saved credentials
        console.log(`[AeroAPI] Refresh failed, re-logging in...`);
        const loginRes = await axios.post(`${API_BASE}/auth/login`, {
          identifier: this.credentials.email,
          password: this.credentials.password
        }, { validateStatus: () => true });

        if (loginRes.status === 200 || loginRes.status === 201) {
          this.accessToken = loginRes.data.accessToken || loginRes.data.token;
          const setCookies = loginRes.headers["set-cookie"] || [];
          for (const c of setCookies) {
            if (c.includes("refreshToken")) {
              this.refreshTokenCookie = c;
            }
          }
          console.log(`[AeroAPI] Re-login successful at ${ts()}`);
          refreshed = true;
        }
      }

      if (refreshed && this.socket) {
        this.socket.auth.token = this.accessToken;
        this.socket.disconnect().connect();
        console.log(`[AeroAPI] Socket re-connected with fresh token.`);
      }
      return refreshed;
    } catch (err) {
      console.error(`[AeroAPI] Token refresh error: ${err.message}`);
      // Try re-login
      if (this.credentials) {
        try {
          const loginRes = await axios.post(`${API_BASE}/auth/login`, {
            identifier: this.credentials.email,
            password: this.credentials.password
          });
          this.accessToken = loginRes.data.accessToken || loginRes.data.token;
          if (this.socket) {
            this.socket.auth.token = this.accessToken;
            this.socket.disconnect().connect();
            console.log(`[AeroAPI] Socket reconnected with fresh token after re-login error.`);
          }
          return true;
        } catch (e) {
          console.error(`[AeroAPI] Re-login also failed: ${e.message}`);
        }
      }
      return false;
    }
  }

  /**
   * Disconnect from Aero
   */
  disconnect() {
    this._connected = false;
    this.accessToken = null;
    this.refreshTokenCookie = null;
    this.credentials = null;
    this.user = null;
    this.docks = [];

    if (this._refreshTimer) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = null;
    }

    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  _decodeTokenUserId(token) {
    try {
      const parts = token.split(".");
      if (parts.length !== 3) return null;
      let base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      while (base64.length % 4) base64 += "=";
      const payload = Buffer.from(base64, "base64").toString("utf-8");
      const decoded = JSON.parse(payload);
      return decoded.userId || decoded.id;
    } catch (e) {
      return null;
    }
  }

  async fetchMe() {
    try {
      try {
        const profile = await this._get("/auth/me");
        if (profile && (profile.username || profile._id)) {
          this.user = profile;
          return profile;
        }
      } catch (err) {
        const userId = this._decodeTokenUserId(this.accessToken);
        if (userId) {
          const profile = await this._get(`/users/${userId}`);
          if (profile) {
            this.user = profile;
            return profile;
          }
        }
      }
    } catch (err) {
      console.error("[AeroAPI] Failed to fetch profile:", err.message);
    }
    return null;
  }

  /**
   * Register a callback for incoming messages
   */
  onMessage(callback) {
    this.messageListeners.push(callback);
  }

  /**
   * Register a callback for outgoing messages
   */
  onMessageSent(callback) {
    this.messageSentListeners.push(callback);
  }

  /**
   * Register a callback for task status change
   */
  onTaskStatusChanged(callback) {
    this.taskStatusListeners.push(callback);
  }

  /**
   * Create a workspace task
   */
  async createWorkspaceTask(dockId, title, description = "", status = "todo") {
    const res = await axios.post(
      `${API_BASE}/workspace/tasks`,
      { dockId, title, description, status },
      { headers: this._authHeaders() }
    );
    return res.data;
  }

  // ─── Internal ─────────────────────────────────────────────

  _authHeaders() {
    return {
      "Authorization": `Bearer ${this.accessToken}`,
      "Content-Type": "application/json"
    };
  }

  async _get(endpoint) {
    const res = await axios.get(`${API_BASE}${endpoint}`, {
      headers: this._authHeaders()
    });
    return res.data;
  }

  _startRefreshTimer() {
    if (this._refreshTimer) clearInterval(this._refreshTimer);
    // Refresh every 4 minutes
    this._refreshTimer = setInterval(() => {
      this.refreshToken().catch(err => {
        console.error("[AeroAPI] Auto-refresh failed:", err.message);
      });
    }, 4 * 60 * 1000);
  }

  _connectSocket() {
    try {
      const { io } = require("socket.io-client");
      this.socket = io(SOCKET_BASE, {
        auth: { token: this.accessToken },
        transports: ["websocket"],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 2000,
        reconnectionDelayMax: 30000,
        randomizationFactor: 0.5
      });

      this.socket.on("connect", () => {
        console.log(`[AeroAPI] Socket connected: ${this.socket.id}`);
      });

      this.socket.on("dock:message", (data) => {
        console.log(`[AeroAPI] New message in dock ${data.dockId || "unknown"}`);
        for (const listener of this.messageListeners) {
          try {
            const msg = {
              dockId: data.dockId,
              ...(data.message || data),
              isGroup: true
            };
            listener(msg);
          } catch (e) { console.error("[AeroAPI] Listener error:", e); }
        }
      });

      this.socket.on("newMessage", (data) => {
        console.log(`[AeroAPI] New DM message:`, JSON.stringify(data));
        for (const listener of this.messageListeners) {
          try {
            const senderId = typeof data.senderId === "object" ? data.senderId?._id || data.senderId?.id : data.senderId;
            const receiverId = typeof data.receiverId === "object" ? data.receiverId?._id || data.receiverId?.id : (data.receiverId || data.recipientId);
            const botUserId = this.user?._id || this.user?.id;
            const partnerId = senderId === botUserId ? receiverId : senderId;

            const msg = {
              dockId: partnerId,
              isGroup: false,
              senderId: senderId,
              sender: typeof data.senderId === "object" ? data.senderId : { id: senderId },
              text: data.text || "",
              createdAt: data.createdAt,
              updatedAt: data.updatedAt,
              isSystemMessage: data.isSystemMessage || false,
              systemMessageType: data.systemMessageType || null
            };
            listener(msg);
          } catch (e) { console.error("[AeroAPI] DM Listener error:", e); }
        }
      });

      this.socket.on("workspace:task:status_changed", (data) => {
        console.log(`[AeroAPI] Task status changed in dock ${data.dockId || "unknown"}: task ${data.taskId} status ${data.status}`);
        for (const listener of this.taskStatusListeners) {
          try {
            listener(data);
          } catch (e) { console.error("[AeroAPI] TaskStatusListener error:", e); }
        }
      });

      this.socket.on("disconnect", (reason) => {
        console.log(`[AeroAPI] Socket disconnected: ${reason}`);
      });

      this.socket.on("connect_error", async (err) => {
        console.error(`[AeroAPI] Socket error: ${err.message}`);
        if (err.message && (err.message.includes("auth") || err.message.includes("token") || err.message.includes("unauthorized") || err.message.includes("401"))) {
          const now = Date.now();
          if ((now - this._lastTokenRefreshTime) > 30000) {
            this._lastTokenRefreshTime = now;
            console.log("[AeroAPI] Socket auth error. Attempting token refresh...");
            const refreshed = await this.refreshToken();
            if (refreshed) {
              this.socket.auth.token = this.accessToken;
              this.socket.disconnect().connect();
              console.log("[AeroAPI] Socket reconnected with fresh token after auth error.");
            }
          } else {
            console.log("[AeroAPI] Token refresh throttled to prevent reconnect loop.");
          }
        }
      });
    } catch (err) {
      console.error(`[AeroAPI] Socket.io connection failed: ${err.message}`);
    }
  }
}

function ts() {
  return new Date().toLocaleTimeString();
}

module.exports = { AeroAPI };
