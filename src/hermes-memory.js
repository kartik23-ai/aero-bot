"use strict";

const fs = require("node:fs");
const path = require("node:path");

const MEMORY_PATH = path.join(__dirname, "..", "db", "user_memory.json");
const SAVE_THROTTLE_MS = 5000; // Save at most once every 5 seconds

class HermesMemory {
  constructor() {
    this.cache = new Map();
    this._saveScheduled = false;
    this._loadMemory();
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
          // Removed noisy success log to reduce console spam
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
    const updated = { ...current, ...newFacts };
    
    // Clean up empty keys
    for (const key of Object.keys(updated)) {
      if (updated[key] === null || updated[key] === undefined || updated[key] === "") {
        delete updated[key];
      }
    }

    this.cache.set(userId, updated);
    this._saveMemoryAsync();
  }

  // Helper to compile facts into a clean string for the prompt context
  // Token budget: ~100 tokens max for facts
  compileFactsString(userId) {
    const memory = this.getUserMemory(userId);
    const entries = Object.entries(memory).filter(([k]) => k !== "_history" && k !== "_interactionCount");
    if (entries.length === 0) return "None yet.";
    
    // Limit to 8 most recent facts and trim values to 50 chars
    return entries.slice(-8).map(([key, val]) => `- ${key}: ${String(val).substring(0, 50)}`).join("\n");
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
      const facts = Object.entries(data).filter(([k]) => k !== "_history" && k !== "_interactionCount");
      list.push({
        id: userId,
        interactionCount: data._interactionCount || 0,
        historyCount: data._history ? data._history.length : 0,
        factsCount: facts.length,
        facts: Object.fromEntries(facts)
      });
    }
    return list;
  }
}

module.exports = { HermesMemory: new HermesMemory() };
