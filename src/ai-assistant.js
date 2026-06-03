"use strict";

const { detectLanguage, t } = require("./i18n");
let Groq;
try {
  Groq = require("groq-sdk");
} catch (e) {
  Groq = null;
}

class AiAssistant {
  constructor(options = {}) {
    this.model = options.model || "llama-3.3-70b-versatile";
    this.enabled = options.enabled !== false;
    this.faq = options.faq || new Map();
    
    // Support single key or comma-separated keys pool
    let keys = [];
    if (process.env.GROQ_API_KEY) {
      keys = process.env.GROQ_API_KEY.split(",").map(k => k.trim()).filter(Boolean);
    }
    if (keys.length === 0) {
      keys = [
        "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",
        "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"
      ];
    }
    this.keys = keys;
    this.currentKeyIndex = 0;
    this.groq = null;
  }

  async runChatCompletion(params) {
    if (!Groq) throw new Error("groq-sdk not installed");
    if (this.keys.length === 0) throw new Error("No API keys configured");

    let lastError = null;
    for (let attempts = 0; attempts < this.keys.length; attempts++) {
      const activeKey = this.keys[this.currentKeyIndex];
      if (!this.groq || this.groq.apiKey !== activeKey) {
        this.groq = new Groq({ apiKey: activeKey });
        // Set a property to track which key is active on the instance
        this.groq.apiKey = activeKey;
      }
      try {
        return await this.groq.chat.completions.create(params);
      } catch (err) {
        console.error(`[AI] chat.completions failed with key index ${this.currentKeyIndex}:`, err.message);
        lastError = err;
        // Cycle to next key in the pool
        this.currentKeyIndex = (this.currentKeyIndex + 1) % this.keys.length;
        this.groq = new Groq({ apiKey: this.keys[this.currentKeyIndex] });
        this.groq.apiKey = this.keys[this.currentKeyIndex];
      }
    }
    throw lastError || new Error("All keys exhausted");
  }

  async answer({ text, rules, role = "USER", language }) {
    const lang = language || detectLanguage(text);
    const normalized = String(text || "").toLowerCase();

    if (!this.enabled) return "AI assistant is disabled.";

    const isSummaryOrAdmin = normalized.includes("summarize") || normalized.includes("chat history") || role === "ADMIN";

    if (!isSummaryOrAdmin) {
      const isShort = normalized.length < 15;
      if (isShort) {
        if (normalized === "help" || normalized === "?") return t(lang, "help");
        if (normalized === "rule" || normalized === "rules") {
          return `Rules: ${rules || "Be respectful and avoid spam."}`;
        }
        if (normalized === "faq" || normalized === "faqs") {
          return "FAQ: Use /rules for rules, /report for issues, and mention @AeroGroupGuard help for assistance.";
        }
      }

      for (const [question, answer] of this.faq.entries()) {
        if (normalized === question.toLowerCase()) return answer;
      }
    }

    try {
      const response = await this.runChatCompletion({
        messages: [
          {
            role: "system",
            content: `You are AeroGroupGuard, a friendly and conversational AI assistant bot for Aero Messenger chats. Respond to the user's question in an engaging, supportive, and helpful tone. Guidelines:
            1. Keep your reply concise (no more than 1-2 short paragraphs).
            2. Do NOT write coding scripts, generate code blocks, or solve programming tasks.
            3. Strictly refuse to assist with any illegal, unethical, or malicious activities.
            Group Rules to respect: ${rules || "Be respectful and avoid spam."}`
          },
          {
            role: "user",
            content: text
          }
        ],
        model: this.model,
        max_tokens: 800,
        temperature: 0.7
      });
      return response.choices[0]?.message?.content || "No response received from AI.";
    } catch (err) {
      return `AI Assistant Error (All keys exhausted): ${err.message}`;
    }
  }
}

module.exports = { AiAssistant };
