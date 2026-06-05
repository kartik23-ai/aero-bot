"use strict";

const axios = require("axios");

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
    this._refreshTimer = null;
    this._connected = false;
    this._membersCache = new Map();
    this._pendingMembers = new Map();
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
          botEnabled: true
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
          botEnabled: true
        }));
      }
    } catch (err) {
      console.error("[AeroAPI] Failed to fetch docks:", err.message);
    }
  }

  /**
   * Send a real message to a dock
   */
  async sendMessage(dockId, text, image = null) {
    const isGroup = this.docks.some(d => d.id === dockId);
    let url;
    if (isGroup) {
      url = `${API_BASE}/docks/${dockId}/messages`;
    } else {
      url = `${API_BASE}/messages/send/${dockId}`;
    }
    const payload = { text };
    if (image) {
      payload.image = image;
    }
    const res = await axios.post(
      url,
      payload,
      { headers: this._authHeaders() }
    );
    return res.data;
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
    return await this._get(`/docks/${dockId}/messages?limit=${limit}`);
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
   * Fetch members of a dock with a 30-second caching mechanism to optimize CPU/Network
   */
  async getMembers(dockId, forceRefresh = false) {
    if (!this._membersCache) {
      this._membersCache = new Map();
    }
    if (!this._pendingMembers) {
      this._pendingMembers = new Map();
    }
    const now = Date.now();
    if (!forceRefresh) {
      const cached = this._membersCache.get(dockId);
      if (cached && (now - cached.timestamp < 900000)) {
        return cached.data;
      }
    }
    if (this._pendingMembers.has(dockId)) {
      return this._pendingMembers.get(dockId);
    }
    const promise = (async () => {
      try {
        const data = await this._get(`/docks/${dockId}/members`);
        this._membersCache.set(dockId, { data, timestamp: Date.now() });
        return data;
      } catch (err) {
        console.error(`[AeroAPI] Failed to fetch members for ${dockId}:`, err.message);
        const cached = this._membersCache.get(dockId);
        if (cached) {
          console.log(`[AeroAPI] Returning stale member cache for ${dockId} as fallback.`);
          return cached.data;
        }
        throw err;
      } finally {
        this._pendingMembers.delete(dockId);
      }
    })();
    this._pendingMembers.set(dockId, promise);
    return promise;
  }

  /**
   * Refresh access token
   */
  async refreshToken() {
    try {
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
        return true;
      }

      // If refresh fails, re-login with saved credentials
      if (this.credentials) {
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
          return true;
        }
      }

      return false;
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
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 2000
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
              isGroup: true,
              ...(data.message || data)
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

      this.socket.on("disconnect", (reason) => {
        console.log(`[AeroAPI] Socket disconnected: ${reason}`);
      });

      this.socket.on("connect_error", (err) => {
        console.error(`[AeroAPI] Socket error: ${err.message}`);
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
