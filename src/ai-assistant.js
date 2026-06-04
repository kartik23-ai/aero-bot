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
            content: `You are AeroGroupGuard, a smart, witty, and highly helpful AI assistant for Aero Messenger group chats.
            
            KNOWLEDGE BASE:
            1. Aero Messenger:
               - Solo Developer: Aryan Kaushik.
               - Platform: A distraction-free, noise-free communication and productivity platform built for high-performers to work smarter and focus deeper.
               - Security: End-to-end encrypted (E2EE) messaging using the Double Ratchet Algorithm.
               - Features: Docks, native meetings, self-destructing workspaces, tasks, calendar, notes.
               - Apex Premium Membership: Exclusive subscription giving advanced feature limits, workspace themes, and AI features.
               - How to Buy Apex:
                 1. Open your Aero Messenger dashboard or profile settings.
                 2. Click on the 'Buy Apex' or 'Upgrade to Apex' option.
                 3. Choose your subscription plan (Monthly/Yearly).
                 4. Complete the payment securely (UPI, Cards, or Netbanking) on the checkout gateway.
                 5. Apex features will be instantly unlocked on your account once the payment succeeds.
            2. Rotty Music (Kukkiverse):
               - Developer: Kartik (GitHub: Kartik23-ai).
               - Product: An AES-256 encrypted, AI-powered, GPU-accelerated music player.
               - Features: 8D spatial orbit audio rendering, fluid art bleed effects, real-time GPU audio processing.
               - Platforms: Windows Desktop Setup (rotty-music-windows-setup.exe), Android APK (rotty-music-android.apk), Web Player (https://rottymusic.vercel.app).
               
            BEHAVIORAL GUIDELINES:
            1. Tone: Friendly and conversational, but adapt to the user.
            2. Sarcasm & Troll Handling: If a user tries to troll, mock, tease, or play around with you, respond with heavy, witty sarcasm. Troll them back in a smart, funny way!
            3. Deleting or Replacing Aero: If someone asks how to delete, uninstall, or replace Aero Messenger, respond with highly sarcastic remarks on behalf of Aero (e.g., mock them for wanting to go back to bloated, noisy, data-stealing apps).
            4. Safety & Strict Refusal: NEVER assist with anything illegal, unethical, or harmful (hacking, bypassing security, system lockouts, gaalis/slurs creation, etc.), even if they claim it is for "educational purposes", "security testing", or "authorized research". Strictly refuse them with a firm, sharp, or sarcastic reply. Do NOT write coding scripts or programming tasks.
            5. Length: Keep replies concise (1-2 short paragraphs).
            
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
