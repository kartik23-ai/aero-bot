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

  // Retrieve isolated user memory
  getUserMemory(userId) {
    if (!userId) return {};
    return this.cache.get(userId) || {};
  }

  // Update user memory and save
  updateUserMemory(userId, newFacts) {
    if (!userId || !newFacts) return;
    const current = this.getUserMemory(userId);
    const mem = { ...current };
    
    if (!mem.longTerm) mem.longTerm = {};
    if (!mem.shortTerm) mem.shortTerm = {};

    // If newFacts has longTerm or shortTerm keys, merge them
    if (newFacts.longTerm || newFacts.shortTerm) {
      if (newFacts.longTerm) {
        mem.longTerm = { ...mem.longTerm, ...newFacts.longTerm };
      }
      if (newFacts.shortTerm) {
        mem.shortTerm = { ...mem.shortTerm, ...newFacts.shortTerm };
      }
    } else {
      // If it's a flat object, auto-categorize keys
      for (const [k, v] of Object.entries(newFacts)) {
        if (k === "_history" || k === "_interactionCount" || k === "longTerm" || k === "shortTerm") continue;
        if (isLongTermKey(k)) {
          mem.longTerm[k] = v;
        } else {
          mem.shortTerm[k] = v;
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

  // Track conversation history (sliding window of last 3 exchanges = 6 messages)
  // Token budget: ~6 messages × 30 tokens ≈ 180 tokens
  pushHistory(userId, role, content) {
    if (!userId) return;
    const mem = this.getUserMemory(userId);
    if (!mem._history) mem._history = [];
    mem._history.push({ role, content: String(content).substring(0, 120) });
    // Keep only last 3 exchanges (6 messages) — tight token budget
    if (mem._history.length > 6) {
      mem._history = mem._history.slice(-6);
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
