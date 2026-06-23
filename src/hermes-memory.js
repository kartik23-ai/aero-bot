"use strict";

const fs = require("node:fs");
const path = require("node:path");

const MEMORY_PATH = path.join(__dirname, "..", "db", "user_memory.json");
const SAVE_THROTTLE_MS = 5000; // Save at most once every 5 seconds

function isLongTermKey(key) {
  const k = String(key).toLowerCase();
  const longTermKeywords = [
    "name", "user", "nick", "address", "city", "town", "country", "state", "place", "live", "reside",
    "age", "gender", "birth", "job", "profession", "work", "office", "school", "college", "uni", "education",
    "hobby", "hobbies", "interest", "preference", "like", "dislike", "fav", "relation", "family", "friend",
    "creator", "owner", "lang"
  ];
  return longTermKeywords.some(kw => k.includes(kw));
}

class HermesMemory {
  constructor() {
    this.cache = new Map();
    this._saveScheduled = false;
    this.saveCallback = null;
    this._loadMemory();
  }

  setSaveCallback(cb) {
    this.saveCallback = cb;
  }

  loadFromObject(obj) {
    if (!obj || typeof obj !== "object") return;
    this.cache.clear();
    for (const [userId, data] of Object.entries(obj)) {
      this.cache.set(userId, data);
    }
    console.log(`[HermesMemory] Loaded memory for ${this.cache.size} users from cloud.`);
    // Write local backup
    try {
      fs.writeFileSync(MEMORY_PATH, JSON.stringify(obj, null, 2), "utf-8");
    } catch (err) {
      console.error("[HermesMemory] Failed to write local memory backup after cloud load:", err.message);
    }
  }

  // Load user memories from disk
  _loadMemory() {
    try {
      if (fs.existsSync(MEMORY_PATH)) {
        const raw = fs.readFileSync(MEMORY_PATH, "utf-8");
        const parsed = JSON.parse(raw);
        for (const [userId, data] of Object.entries(parsed)) {
          this.cache.set(userId, data);
        }
        console.log(`[HermesMemory] Loaded memory for ${this.cache.size} users.`);
      } else {
        console.log("[HermesMemory] No existing user memory file found. Starting fresh.");
      }
    } catch (err) {
      console.error("[HermesMemory] Failed to load memory file:", err.message);
    }
  }

  // Throttled async save — prevents spamming disk writes on every message
  _saveMemoryAsync() {
    if (this._saveScheduled) return; // Already scheduled, skip
    this._saveScheduled = true;
    setTimeout(() => {
      this._saveScheduled = false;
      try {
        const obj = {};
        for (const [userId, data] of this.cache.entries()) {
          obj[userId] = data;
        }
        fs.writeFile(MEMORY_PATH, JSON.stringify(obj, null, 2), "utf-8", (err) => {
          if (err) {
            console.error("[HermesMemory] Async save failed:", err.message);
          }
          if (this.saveCallback) {
            this.saveCallback(obj);
          }
        });
      } catch (err) {
        console.error("[HermesMemory] Failed to schedule memory save:", err.message);
      }
    }, SAVE_THROTTLE_MS);
  }

  // Expire short-term memory keys older than 30 minutes (1800000 ms)
  _expireShortTermMemory(mem) {
    if (!mem.shortTerm) return false;
    if (!mem._shortTermTimestamps) mem._shortTermTimestamps = {};
    
    const now = Date.now();
    let expiredAny = false;
    const TTL = 30 * 60 * 1000; // 30 minutes
    
    // Check keys in shortTerm
    for (const key of Object.keys(mem.shortTerm)) {
      const timestamp = mem._shortTermTimestamps[key];
      if (!timestamp) {
        mem._shortTermTimestamps[key] = now;
      } else if (now - timestamp > TTL) {
        delete mem.shortTerm[key];
        delete mem._shortTermTimestamps[key];
        expiredAny = true;
      }
    }
    
    // Clean up timestamps for keys that no longer exist in shortTerm
    for (const key of Object.keys(mem._shortTermTimestamps)) {
      if (!mem.shortTerm[key]) {
        delete mem._shortTermTimestamps[key];
      }
    }
    
    return expiredAny;
  }

  // Retrieve isolated user memory with auto-expiration
  getUserMemory(userId) {
    if (!userId) return {};
    const mem = this.cache.get(userId);
    if (!mem) return {};
    const expired = this._expireShortTermMemory(mem);
    if (expired) {
      this.cache.set(userId, mem);
      this._saveMemoryAsync();
    }
    return mem;
  }

  // Update user memory and save
  updateUserMemory(userId, newFacts) {
    if (!userId || !newFacts) return;
    const current = this.getUserMemory(userId);
    const mem = { ...current };
    
    if (!mem.longTerm) mem.longTerm = {};
    if (!mem.shortTerm) mem.shortTerm = {};
    if (!mem._shortTermTimestamps) mem._shortTermTimestamps = {};

    const now = Date.now();

    // If newFacts has longTerm or shortTerm keys, merge them
    if (newFacts.longTerm || newFacts.shortTerm) {
      if (newFacts.longTerm) {
        mem.longTerm = { ...mem.longTerm, ...newFacts.longTerm };
      }
      if (newFacts.shortTerm) {
        for (const [k, v] of Object.entries(newFacts.shortTerm)) {
          mem.shortTerm[k] = v;
          mem._shortTermTimestamps[k] = now;
        }
      }
    } else {
      // If it's a flat object, auto-categorize keys
      for (const [k, v] of Object.entries(newFacts)) {
        if (k === "_history" || k === "_interactionCount" || k === "longTerm" || k === "shortTerm") continue;
        if (isLongTermKey(k)) {
          mem.longTerm[k] = v;
        } else {
          mem.shortTerm[k] = v;
          mem._shortTermTimestamps[k] = now;
        }
      }
    }

    // Clean up empty keys
    for (const key of Object.keys(mem.longTerm)) {
      if (mem.longTerm[key] === null || mem.longTerm[key] === undefined || mem.longTerm[key] === "") {
        delete mem.longTerm[key];
      }
    }
    for (const key of Object.keys(mem.shortTerm)) {
      if (mem.shortTerm[key] === null || mem.shortTerm[key] === undefined || mem.shortTerm[key] === "") {
        delete mem.shortTerm[key];
        delete mem._shortTermTimestamps[key];
      }
    }

    this.cache.set(userId, mem);
    this._saveMemoryAsync();
  }

  // Helper to compile facts into a clean string for the prompt context
  compileFactsString(userId) {
    const memory = this.getUserMemory(userId);
    let longTerm = memory.longTerm || {};
    let shortTerm = memory.shortTerm || {};

    // Auto-migrate flat facts if present
    const flatEntries = Object.entries(memory).filter(([k]) => k !== "_history" && k !== "_interactionCount" && k !== "longTerm" && k !== "shortTerm");
    if (flatEntries.length > 0 && Object.keys(longTerm).length === 0 && Object.keys(shortTerm).length === 0) {
      longTerm = {};
      shortTerm = {};
      const updatedMem = { ...memory };
      for (const [k, v] of flatEntries) {
        if (isLongTermKey(k)) longTerm[k] = v;
        else shortTerm[k] = v;
        delete updatedMem[k];
      }
      updatedMem.longTerm = longTerm;
      updatedMem.shortTerm = shortTerm;
      this.cache.set(userId, updatedMem);
      this._saveMemoryAsync();
    }

    const ltEntries = Object.entries(longTerm);
    const stEntries = Object.entries(shortTerm);

    if (ltEntries.length === 0 && stEntries.length === 0) {
      return "None yet.";
    }

    let result = "";
    if (ltEntries.length > 0) {
      result += "Long-term info (important facts about your friend):\n" + ltEntries.map(([k, v]) => `  - ${k}: ${v}`).join("\n") + "\n";
    }
    if (stEntries.length > 0) {
      result += "Short-term/Temporary context (casual things happening right now):\n" + stEntries.map(([k, v]) => `  - ${k}: ${v}`).join("\n") + "\n";
    }
    return result.trim();
  }

  // Track conversation history (sliding window of last 5 exchanges = 10 messages)
  // Token budget: ~10 messages × 100 tokens ≈ 1000 tokens (well within AI provider limit)
  pushHistory(userId, role, content) {
    if (!userId) return;
    const mem = this.getUserMemory(userId);
    if (!mem._history) mem._history = [];
    mem._history.push({ role, content: String(content).substring(0, 500) });
    // Keep only last 5 exchanges (10 messages) for better conversation context
    if (mem._history.length > 10) {
      mem._history = mem._history.slice(-10);
    }
    // Track interaction count
    if (role === "user") {
      mem._interactionCount = (mem._interactionCount || 0) + 1;
    }
    this.cache.set(userId, mem);
    this._saveMemoryAsync();
  }

  // Get conversation history formatted for LLM
  getHistoryMessages(userId) {
    const mem = this.getUserMemory(userId);
    if (!mem._history || mem._history.length === 0) return [];
    return mem._history.map(h => ({ role: h.role, content: h.content }));
  }

  // Get interaction count
  getInteractionCount(userId) {
    const mem = this.getUserMemory(userId);
    return mem._interactionCount || 0;
  }

  // Clear all facts/history for a user
  clearUserMemory(userId) {
    if (!userId) return;
    this.cache.delete(userId);
    this._saveMemoryAsync();
  }

  // Get list of all users and metadata
  getAllUserMemories() {
    const list = [];
    for (const [userId, data] of this.cache.entries()) {
      let longTerm = data.longTerm || {};
      let shortTerm = data.shortTerm || {};
      
      const flatEntries = Object.entries(data).filter(([k]) => k !== "_history" && k !== "_interactionCount" && k !== "longTerm" && k !== "shortTerm");
      if (flatEntries.length > 0 && Object.keys(longTerm).length === 0 && Object.keys(shortTerm).length === 0) {
        longTerm = {};
        shortTerm = {};
        for (const [k, v] of flatEntries) {
          if (isLongTermKey(k)) longTerm[k] = v;
          else shortTerm[k] = v;
        }
      }

      list.push({
        id: userId,
        interactionCount: data._interactionCount || 0,
        historyCount: data._history ? data._history.length : 0,
        factsCount: Object.keys(longTerm).length + Object.keys(shortTerm).length,
        facts: {
          longTerm,
          shortTerm
        }
      });
    }
    return list;
  }
}

module.exports = { HermesMemory: new HermesMemory() };
