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
    
    const apiKey = process.env.GROQ_API_KEY || "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";
    if (Groq && apiKey) {
      this.groq = new Groq({ apiKey });
    }
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

    if (this.groq) {
      try {
        const response = await this.groq.chat.completions.create({
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
        return `AI Assistant Error: ${err.message}`;
      }
    }

    return "I can help with rules, reports, summaries, and group questions.";
  }
}

module.exports = { AiAssistant };
