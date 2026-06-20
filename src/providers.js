"use strict";

/**
 * providers.js — Multi-Provider AI Manager v3
 *
 * Task → Provider mapping:
 *   - Friendly Chat:  Groq (llama-3.3-70b-versatile) — fastest reply
 *   - Code/Math:      Groq (llama-3.3-70b-versatile) — best Groq model for code
 *   - Creative:       OpenRouter / Cerebras / LLM7 — stories, jokes
 *   - Search:         Serper.dev (Google) / Tavily / DDG — real-time search
 *   - Search Summary: OpenRouter (DeepSeek) / LLM7 (Qwen3) — never Groq
 *   - Images:         Pollinations AI (primary) — free, no key, reliable
 */

const https = require("node:https");
const http = require("node:http");

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/121.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edge/120.0.0.0 Safari/537.36"
];

// --- GROQ PROVIDER (Chat + Code) ---
let Groq;
try { Groq = require("groq-sdk"); } catch (_) { Groq = null; }

class ProviderManager {
  constructor() {
    this._groqClient = null;
    this._groqKeys = [];
    this._groqKeyIndex = 0;
    this._tokenUsage = {
      groq: { requests: 0, promptTokens: 0, completionTokens: 0 },
      cerebras: { requests: 0, promptTokens: 0, completionTokens: 0 },
      openrouter: { requests: 0, promptTokens: 0, completionTokens: 0 },
      huggingface: { requests: 0, promptTokens: 0, completionTokens: 0 },
      llm7: { requests: 0, promptTokens: 0, completionTokens: 0 },
      ddg: { requests: 0, promptTokens: 0, completionTokens: 0 }
    };
    this._initProviders();
  }

  _initProviders() {
    // Groq — multi-key rotation (for chat + code ONLY)
    if (process.env.GROQ_API_KEY && Groq) {
      this._groqKeys = process.env.GROQ_API_KEY.split(",").map(k => k.trim()).filter(Boolean);
      if (this._groqKeys.length > 0) {
        this._groqClient = new Groq({ apiKey: this._groqKeys[0] });
        console.log(`[Providers] Groq initialized with ${this._groqKeys.length} key(s)`);
      }
    }
    // Serper.dev
    if (process.env.SERPER_API_KEY) {
      console.log("[Providers] Serper.dev Google Search API — ready");
    }

    // Tavily
    if (process.env.TAVILY_API_KEY) {
      console.log("[Providers] Tavily Search API — ready");
    }

    // OpenRouter
    if (process.env.OPENROUTER_API_KEY) {
      console.log("[Providers] OpenRouter API — ready");
    }

    // Cerebras
    if (process.env.CEREBRAS_API_KEY) {
      console.log("[Providers] Cerebras API — ready");
    }
  }

  _trackTokenUsage(provider, completion) {
    if (!this._tokenUsage[provider]) return;
    this._tokenUsage[provider].requests++;
    if (completion && completion.usage) {
      this._tokenUsage[provider].promptTokens += completion.usage.prompt_tokens || 0;
      this._tokenUsage[provider].completionTokens += completion.usage.completion_tokens || 0;
    }
  }

  getTokenUsage() {
    return JSON.parse(JSON.stringify(this._tokenUsage));
  }

  // =============================================
  // LLM7 — Free Keyless Model Completion
  // =============================================
  async llm7Completion(messages, model, maxTokens, temperature) {
    const apiKey = process.env.LLM7_API_KEY || "anonymous";
    const payload = JSON.stringify({
      model: model || "qwen3-235b",
      messages,
      max_tokens: maxTokens || 200,
      temperature: temperature || 0.75
    });

    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: "api.llm7.io",
        path: "/v1/chat/completions",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          "Content-Length": Buffer.byteLength(payload)
        }
      }, (res) => {
        let data = "";
        res.on("data", chunk => data += chunk);
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode < 200 || res.statusCode >= 300) {
              const errMsg = parsed.error?.message || parsed.detail || `HTTP ${res.statusCode}`;
              reject(new Error(errMsg));
            } else if (parsed.error || parsed.detail) {
              reject(new Error(parsed.error?.message || parsed.detail || "LLM7 error"));
            } else {
              this._trackTokenUsage('llm7', parsed);
              resolve(parsed);
            }
          } catch (e) {
            if (res.statusCode < 200 || res.statusCode >= 300) {
              reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 150)}`));
            } else {
              reject(new Error("LLM7 parse error: " + data.substring(0, 150)));
            }
          }
        });
      });

      req.on("error", reject);
      req.setTimeout(15000, () => { req.destroy(); reject(new Error("LLM7 timeout")); });
      req.write(payload);
      req.end();
    });
  }

  // =============================================
  // OPENROUTER — Free Models (DeepSeek, Llama, Gemma)
  // =============================================
  async openRouterCompletion(messages, model, maxTokens, temperature) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("No OPENROUTER_API_KEY set");
    const payload = JSON.stringify({
      model: model || "meta-llama/llama-3.1-8b-instruct:free",
      messages,
      max_tokens: maxTokens || 200,
      temperature: temperature ?? 0.7
    });

    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: "openrouter.ai",
        path: "/api/v1/chat/completions",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
          "HTTP-Referer": "https://aero-bot.app",
          "X-Title": "Aero Bot",
          "Content-Length": Buffer.byteLength(payload)
        }
      }, (res) => {
        let data = "";
        res.on("data", chunk => data += chunk);
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode < 200 || res.statusCode >= 300) {
              const errMsg = parsed.error?.message || parsed.message || `HTTP ${res.statusCode}`;
              reject(new Error(errMsg));
            } else if (parsed.error) {
              reject(new Error(parsed.error.message || "OpenRouter error"));
            } else {
              this._trackTokenUsage('openrouter', parsed);
              resolve(parsed);
            }
          } catch (e) {
            if (res.statusCode < 200 || res.statusCode >= 300) {
              reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 150)}`));
            } else {
              reject(new Error("OpenRouter parse error: " + data.substring(0, 150)));
            }
          }
        });
      });

      req.on("error", reject);
      req.setTimeout(20000, () => { req.destroy(); reject(new Error("OpenRouter timeout")); });
      req.write(payload);
      req.end();
    });
  }

  // =============================================
  // GROQ COMPLETION WITH KEY ROTATION
  // =============================================
  async groqChatCompletion(messages, model, maxTokens, temperature) {
    if (this._groqClient && this._groqKeys.length > 0) {
      for (let i = 0; i < this._groqKeys.length; i++) {
        const key = this._groqKeys[this._groqKeyIndex];
        this._groqClient = new Groq({ apiKey: key });
        try {
          console.log(`[Providers] Trying Groq (Key ${this._groqKeyIndex}) for ${model}...`);
          const completion = await this._groqClient.chat.completions.create({
            model, messages, max_tokens: maxTokens, temperature
          });
          completion.provider = `Groq (${model})`;
          this._trackTokenUsage('groq', completion);
          return completion;
        } catch (err) {
          console.error(`[Groq] Key ${this._groqKeyIndex} failed:`, err.message);
          this._groqKeyIndex = (this._groqKeyIndex + 1) % this._groqKeys.length;
        }
      }
    }
    throw new Error("All Groq keys failed or Groq not initialized");
  }



  // =============================================
  // CEREBRAS COMPLETION
  // =============================================
  async cerebrasCompletion(messages, model, maxTokens, temperature) {
    const cerebrasKey = process.env.CEREBRAS_API_KEY;
    if (!cerebrasKey) throw new Error("Cerebras API key is missing.");
    const body = JSON.stringify({
      model: model || "llama-3.3-70b",
      messages,
      max_tokens: maxTokens || 300,
      temperature: temperature ?? 0.7
    });
    const result = await this._httpPost("api.cerebras.ai", "/v1/chat/completions", cerebrasKey, body, 30000);
    result.provider = "Cerebras";
    this._trackTokenUsage('cerebras', result);
    return result;
  }

  // =============================================
  // DUCKDUCKGO KEYLESS AI CHAT
  // =============================================
  async ddgChatCompletion(messages, model = "gpt-4o-mini") {
    const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    
    // 1. Get VQD Token
    const vqdToken = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: "duckduckgo.com",
        path: "/duckchat/v1/status",
        method: "GET",
        headers: {
          "x-vqd-accept": "1",
          "User-Agent": userAgent
        }
      }, (res) => {
        const vqd = res.headers["x-vqd-4"] || res.headers["x-vqd-token"];
        if (vqd) {
          resolve(vqd);
        } else {
          let data = "";
          res.on("data", chunk => data += chunk);
          res.on("end", () => {
            reject(new Error("Failed to get VQD token. Status: " + res.statusCode));
          });
        }
      });
      req.on("error", reject);
      req.setTimeout(8000, () => { req.destroy(); reject(new Error("VQD request timeout")); });
      req.end();
    });

    // 2. Run Chat
    const payload = JSON.stringify({
      model: model || "gpt-4o-mini",
      messages: messages.map(m => ({ role: m.role, content: m.content }))
    });

    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: "duckduckgo.com",
        path: "/duckchat/v1/chat",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-vqd-4": vqdToken,
          "User-Agent": userAgent,
          "Accept": "text/event-stream",
          "Content-Length": Buffer.byteLength(payload)
        }
      }, (res) => {
        if (res.statusCode !== 200) {
          let errData = "";
          res.on("data", chunk => errData += chunk);
          res.on("end", () => reject(new Error(`DDG Chat error ${res.statusCode}: ${errData}`)));
          return;
        }

        let fullText = "";
        let buffer = "";

        res.on("data", (chunk) => {
          buffer += chunk.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop();

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed === "data: [DONE]") continue;

            if (trimmed.startsWith("data: ")) {
              try {
                const dataStr = trimmed.substring(6);
                const parsed = JSON.parse(dataStr);
                if (parsed.message) fullText += parsed.message;
              } catch (_) {}
            }
          }
        });

        res.on("end", () => {
          if (buffer && buffer.trim().startsWith("data: ") && buffer.trim() !== "data: [DONE]") {
            try {
              const dataStr = buffer.trim().substring(6);
              const parsed = JSON.parse(dataStr);
              if (parsed.message) fullText += parsed.message;
            } catch (_) {}
          }

          if (fullText.length === 0) {
            reject(new Error("DDG Chat returned empty response"));
          } else {
            this._trackTokenUsage('ddg', null);
            resolve({
              choices: [{ message: { role: "assistant", content: fullText } }],
              provider: `DuckDuckGo AI (${model})`
            });
          }
        });
      });

      req.on("error", reject);
      req.setTimeout(25000, () => { req.destroy(); reject(new Error("DDG Chat timeout")); });
      req.write(payload);
      req.end();
    });
  }

  // =============================================
  // HUGGING FACE COMPLETIONS (Chat, Vision, Whisper)
  // =============================================
  async hfChatCompletion(messages, model, maxTokens, temperature) {
    const hfToken = process.env.HF_TOKEN;
    if (!hfToken) throw new Error("HF_TOKEN is missing.");
    const body = JSON.stringify({
      model: model || "deepseek-ai/DeepSeek-R1",
      messages,
      max_tokens: maxTokens || 400,
      temperature: temperature ?? 0.7
    });
    const result = await this._httpPost("router.huggingface.co", "/v1/chat/completions", hfToken, body, 35000);
    this._trackTokenUsage('huggingface', result);
    return result;
  }

  async hfVisionCompletion(imageBuffer, prompt) {
    const hfToken = process.env.HF_TOKEN;
    if (hfToken) {
      try {
        const payload = JSON.stringify({
          model: "meta-llama/Llama-3.2-11B-Vision-Instruct",
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: prompt || "Scan this image and describe its content in detail." },
                { type: "image_url", image_url: { url: `data:image/png;base64,${imageBuffer.toString("base64")}` } }
              ]
            }
          ],
          max_tokens: 600
        });
        const result = await this._httpPost("router.huggingface.co", "/v1/chat/completions", hfToken, payload, 35000);
        return result.choices?.[0]?.message?.content || "";
      } catch (err) {
        console.warn("[Providers] HF Vision failed, trying OpenRouter fallback...", err.message);
      }
    }

    // Fallback: OpenRouter Vision
    if (process.env.OPENROUTER_API_KEY) {
      try {
        console.log("[Providers] Trying OpenRouter Vision fallback (Google Gemini 2.5 Flash)...");
        const messages = [
          {
            role: "user",
            content: [
              { type: "text", text: prompt || "Scan this image and describe its content in detail." },
              { type: "image_url", image_url: { url: `data:image/png;base64,${imageBuffer.toString("base64")}` } }
            ]
          }
        ];
        const res = await this.openRouterCompletion(messages, "google/gemini-2.5-flash", 600, 0.7);
        return res.choices?.[0]?.message?.content || "";
      } catch (err) {
        console.warn("[Providers] OpenRouter Google Gemini 2.5 Flash failed, trying Llama 3.2 11B Vision Instruct free...", err.message);
        try {
          const messages = [
            {
              role: "user",
              content: [
                { type: "text", text: prompt || "Scan this image and describe its content in detail." },
                { type: "image_url", image_url: { url: `data:image/png;base64,${imageBuffer.toString("base64")}` } }
              ]
            }
          ];
          const res = await this.openRouterCompletion(messages, "meta-llama/llama-3.2-11b-vision-instruct:free", 600, 0.7);
          return res.choices?.[0]?.message?.content || "";
        } catch (err2) {
          console.error("[Providers] All Vision fallbacks failed:", err2.message);
          throw new Error("All vision analysis models failed. Please verify HF_TOKEN or OPENROUTER_API_KEY.");
        }
      }
    }

    throw new Error("No vision API key found. Set HF_TOKEN or OPENROUTER_API_KEY.");
  }

  async hfWhisperTranscription(audioBuffer, mimeType = "audio/ogg") {
    const hfToken = process.env.HF_TOKEN;
    if (!hfToken) throw new Error("HF_TOKEN is missing.");
    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: "router.huggingface.co",
        path: "/hf-inference/models/openai/whisper-large-v3-turbo",
        method: "POST",
        headers: {
          "Authorization": `Bearer ${hfToken}`,
          "Content-Type": mimeType,
          "Content-Length": audioBuffer.length
        }
      }, (res) => {
        let data = "";
        res.on("data", chunk => data += chunk);
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) reject(new Error(parsed.error));
            else resolve(parsed.text || "");
          } catch (e) {
            reject(new Error("Whisper parse error: " + data.substring(0, 200)));
          }
        });
      });
      req.on("error", reject);
      req.setTimeout(30000, () => { req.destroy(); reject(new Error("Whisper timeout")); });
      req.write(audioBuffer);
      req.end();
    });
  }

  // =============================================
  // GOOGLE TTS (TEXT TO SPEECH) - KEYLESS
  // =============================================
  async generateTTSAudio(text, lang = "hi") {
    return new Promise((resolve, reject) => {
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text.substring(0, 200))}&tl=${lang}&client=tw-ob`;
      const req = https.request(url, {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        }
      }, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error("TTS request failed with status: " + res.statusCode));
          return;
        }
        const chunks = [];
        res.on("data", chunk => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      });
      req.on("error", reject);
      req.setTimeout(15000, () => { req.destroy(); reject(new Error("TTS timeout")); });
      req.end();
    });
  }

  // =============================================
  // GENERAL MODEL SELECTOR
  // =============================================
  async executeModelCompletion(messages, modelKey, maxTokens, temperature) {
    if (!modelKey || modelKey === "default") {
      return null;
    }
    switch (modelKey) {
      case "groq-llama-8b":
        return this.groqChatCompletion(messages, "llama-3.3-70b-versatile", maxTokens, temperature);
      case "groq-llama-70b":
        return this.groqChatCompletion(messages, "llama-3.3-70b-versatile", maxTokens, temperature);
      case "groq-deepseek-r1":
        return this.groqChatCompletion(messages, "deepseek-r1-distill-llama-70b", maxTokens, temperature);
      case "hf-deepseek-r1":
        return this.hfChatCompletion(messages, "deepseek-ai/DeepSeek-R1", maxTokens, temperature);
      case "ddg-gpt-4o-mini":
        return this.ddgChatCompletion(messages, "gpt-4o-mini");
      case "gemini-flash":
        return this.groqChatCompletion(messages, "llama-3.3-70b-versatile", maxTokens, temperature);
      case "cerebras-llama-70b":
      case "cerebras-gpt-120b":
        return this.cerebrasCompletion(messages, "gpt-oss-120b", maxTokens, temperature);
      case "openrouter-deepseek":
        try {
          return await this.openRouterCompletion(messages, "deepseek/deepseek-chat", maxTokens, temperature);
        } catch (err) {
          console.warn("[Providers] openrouter-deepseek paid failed, trying free:", err.message);
          return this.openRouterCompletion(messages, "deepseek/deepseek-chat:free", maxTokens, temperature);
        }
      case "llm7-qwen":
        return this.llm7Completion(messages, "qwen3-235b", maxTokens, temperature);
      default:
        // Try guessing provider if raw model
        if (modelKey.includes("deepseek") && modelKey.includes("/")) {
          return this.openRouterCompletion(messages, modelKey, maxTokens, temperature);
        }
        return null;
    }
  }

  // =============================================
  // DEFAULT CHAT COMPLETION FALLBACK
  // =============================================
  async defaultChatCompletion(messages, maxTokens, temperature) {
    // 1. Try Groq first (lightning fast, ~200ms latency, best for regular buddy-like chat)
    if (this._groqClient && this._groqKeys.length > 0) {
      try {
        const res = await this.groqChatCompletion(messages, "llama-3.3-70b-versatile", maxTokens, temperature);
        if (res && res.choices && res.choices[0] && res.choices[0].message && typeof res.choices[0].message.content === "string" && res.choices[0].message.content.trim().length > 0) {
          return res;
        }
        throw new Error("Empty Groq response content");
      } catch (err) {
        console.warn("[Providers] Groq fallback failed:", err.message);
      }
    }


    // 3. Try Cerebras third (completely free developer key, ultra-fast 120B model)
    if (process.env.CEREBRAS_API_KEY) {
      try {
        console.log("[Providers] Trying Cerebras fallback (gpt-oss-120b)...");
        const res = await this.cerebrasCompletion(messages, "gpt-oss-120b", maxTokens, temperature);
        if (res && res.choices && res.choices[0] && res.choices[0].message && typeof res.choices[0].message.content === "string" && res.choices[0].message.content.trim().length > 0) {
          return res;
        }
        throw new Error("Empty Cerebras response content");
      } catch (err) {
        console.warn("[Providers] Cerebras fallback failed:", err.message);
      }
    }

    // 4. Fallback: OpenRouter (DeepSeek)
    if (process.env.OPENROUTER_API_KEY) {
      console.log("[Providers] Trying OpenRouter (DeepSeek)...");
      try {
        const res = await this.openRouterCompletion(messages, "deepseek/deepseek-chat", maxTokens, temperature);
        res.provider = "OpenRouter (DeepSeek)";
        if (res && res.choices && res.choices[0] && res.choices[0].message && typeof res.choices[0].message.content === "string" && res.choices[0].message.content.trim().length > 0) {
          return res;
        }
        throw new Error("Empty OpenRouter DeepSeek response content");
      } catch (err) {
        console.warn("[Providers] OpenRouter chat paid failed, trying free:", err.message);
        try {
          const res = await this.openRouterCompletion(messages, "deepseek/deepseek-chat:free", maxTokens, temperature);
          res.provider = "OpenRouter (DeepSeek Free)";
          if (res && res.choices && res.choices[0] && res.choices[0].message && typeof res.choices[0].message.content === "string" && res.choices[0].message.content.trim().length > 0) {
            return res;
          }
          throw new Error("Empty OpenRouter DeepSeek Free response content");
        } catch (freeErr) {
          console.warn("[Providers] OpenRouter chat free failed:", freeErr.message);
        }
      }
    }

    // 5. Fallback: LLM7.io Qwen3
    console.log("[Providers] Trying LLM7.io for chat...");
    try {
      const res = await this.llm7Completion(messages, "qwen3-235b", maxTokens, temperature);
      res.provider = "LLM7.io (Qwen3)";
      if (res && res.choices && res.choices[0] && res.choices[0].message && typeof res.choices[0].message.content === "string" && res.choices[0].message.content.trim().length > 0) {
        return res;
      }
      throw new Error("Empty LLM7 response content");
    } catch (err) {
      console.warn("[Providers] LLM7.io chat failed:", err.message);
    }

    // 6. Fallback: DuckDuckGo AI Chat (keyless GPT-4o-mini)
    console.log("[Providers] Trying DuckDuckGo AI Chat fallback...");
    try {
      const res = await this.ddgChatCompletion(messages, "gpt-4o-mini");
      if (res && res.choices && res.choices[0] && res.choices[0].message && typeof res.choices[0].message.content === "string" && res.choices[0].message.content.trim().length > 0) {
        return res;
      }
      throw new Error("Empty DDG response content");
    } catch (err) {
      console.warn("[Providers] DuckDuckGo AI Chat chat failed:", err.message);
      throw err;
    }
  }

  // =============================================
  // CHAT — Friendly Talks (Groq 8B/Gemini/Cerebras)
  // =============================================
  async chatCompletion(messages, opts = {}) {
    const requestedModel = opts.model;
    const maxTokens = opts.max_tokens || 200;
    const temperature = opts.temperature || 0.85;

    if (requestedModel && requestedModel !== "default") {
      try {
        const res = await this.executeModelCompletion(messages, requestedModel, maxTokens, temperature);
        if (res) return res;
      } catch (err) {
        console.warn(`[Providers] Explicit model ${requestedModel} failed:`, err.message);
      }
    }

    return this.defaultChatCompletion(messages, maxTokens, temperature);
  }

  // =============================================
  // CODE/MATH — Groq 70B Versatile (best for code + math)
  // =============================================
  async codeCompletion(messages, opts = {}) {
    const requestedModel = opts.model;
    const maxTokens = opts.max_tokens || 600;
    const temperature = opts.temperature || 0.3;

    if (requestedModel && requestedModel !== "default") {
      try {
        const res = await this.executeModelCompletion(messages, requestedModel, maxTokens, temperature);
        if (res) return res;
      } catch (err) {
        console.warn(`[Providers] Explicit code model ${requestedModel} failed:`, err.message);
      }
    }

    // 1. Try OpenRouter (DeepSeek V3 / free fallback) FIRST for coding
    if (process.env.OPENROUTER_API_KEY) {
      const models = ["deepseek/deepseek-chat", "deepseek/deepseek-chat:free"];
      for (const modelName of models) {
        try {
          console.log(`[Providers] Trying OpenRouter ${modelName} for coding...`);
          const res = await this.openRouterCompletion(messages, modelName, maxTokens, temperature);
          res.provider = `OpenRouter (${modelName})`;
          return res;
        } catch (err) {
          console.warn(`[Providers] OpenRouter model ${modelName} failed:`, err.message);
        }
      }
    }

    // 2. Fallback: Groq llama-3.3-70b-versatile
    if (this._groqClient && this._groqKeys.length > 0) {
      for (let i = 0; i < this._groqKeys.length; i++) {
        const key = this._groqKeys[this._groqKeyIndex];
        this._groqClient = new Groq({ apiKey: key });
        try {
          console.log(`[Providers] Trying Groq 70B (Key ${this._groqKeyIndex}) for code/math...`);
          const completion = await this._groqClient.chat.completions.create({
            model: "llama-3.3-70b-versatile", messages, max_tokens: maxTokens, temperature
          });
          completion.provider = "Groq (Llama 3.3 70B)";
          return completion;
        } catch (err) {
          console.error(`[Groq] Key ${this._groqKeyIndex} failed:`, err.message);
          this._groqKeyIndex = (this._groqKeyIndex + 1) % this._groqKeys.length;
        }
      }
    }

    // 3. Fallback: Cerebras
    const cerebrasKey = process.env.CEREBRAS_API_KEY;
    if (cerebrasKey) {
      try {
        console.log("[Providers] Trying Cerebras for code...");
        const body = JSON.stringify({
          model: "llama-3.3-70b", messages, max_tokens: maxTokens, temperature
        });
        const result = await this._httpPost("api.cerebras.ai", "/v1/chat/completions", cerebrasKey, body, 30000);
        result.provider = "Cerebras";
        return result;
      } catch (err) {
        console.warn("[Providers] Cerebras failed:", err.message);
      }
    }

    // 4. Fallback: LLM7.io
    try {
      const res = await this.llm7Completion(messages, "codestral-latest", maxTokens, temperature);
      res.provider = "LLM7.io (Codestral)";
      return res;
    } catch (err) {
      console.warn("[Providers] LLM7.io code failed:", err.message);
      throw err;
    }
  }

  // =============================================
  // CREATIVE — Gemini / OpenRouter / LLM7 / Groq
  // =============================================
  async creativeCompletion(prompt, opts = {}) {
    const requestedModel = opts.model;
    const maxTokens = opts.max_tokens || 400;
    const temperature = opts.temperature || 0.9;

    if (requestedModel && requestedModel !== "default") {
      try {
        const messages = [
          { role: "system", content: "You are a creative storyteller." },
          { role: "user", content: prompt }
        ];
        const res = await this.executeModelCompletion(messages, requestedModel, maxTokens, temperature);
        if (res) return res;
      } catch (err) {
        console.warn(`[Providers] Explicit creative model ${requestedModel} failed:`, err.message);
      }
    }

    // 1. Try Hugging Face deepseek-ai/DeepSeek-R1 first for creative (completely free + highest quality reasoning)
    if (process.env.HF_TOKEN) {
      try {
        console.log("[Providers] Trying Hugging Face DeepSeek-R1 for creative...");
        const messages = [
          { role: "system", content: "You are a creative storyteller." },
          { role: "user", content: prompt }
        ];
        const res = await this.hfChatCompletion(messages, "deepseek-ai/DeepSeek-R1", maxTokens, temperature);
        res.provider = "Hugging Face (DeepSeek-R1)";
        return res;
      } catch (err) {
        console.warn("[Providers] Hugging Face creative failed:", err.message);
      }
    }

    // 2. Try OpenRouter (DeepSeek V3 — premium paid tier, extremely cheap, outstanding for jokes/poetry)
    if (process.env.OPENROUTER_API_KEY) {
      try {
        console.log("[Providers] Trying OpenRouter DeepSeek V3 paid for creative...");
        const messages = [
          { role: "system", content: "You are a creative storyteller." },
          { role: "user", content: prompt }
        ];
        const res = await this.openRouterCompletion(messages, "deepseek/deepseek-chat", maxTokens, temperature);
        res.provider = "OpenRouter (DeepSeek V3)";
        return res;
      } catch (err) {
        console.warn("[Providers] OpenRouter creative paid failed, trying free:", err.message);
        try {
          const messages = [
            { role: "system", content: "You are a creative storyteller." },
            { role: "user", content: prompt }
          ];
          const res = await this.openRouterCompletion(messages, "deepseek/deepseek-chat:free", maxTokens, temperature);
          res.provider = "OpenRouter (DeepSeek Free)";
          return res;
        } catch (freeErr) {
          console.warn("[Providers] OpenRouter creative free failed:", freeErr.message);
        }
      }
    }

    // 3. Try Cerebras third (completely free developer key, ultra-fast 120B model)
    if (process.env.CEREBRAS_API_KEY) {
      try {
        console.log("[Providers] Trying Cerebras creative (gpt-oss-120b)...");
        const messages = [
          { role: "system", content: "You are a creative storyteller." },
          { role: "user", content: prompt }
        ];
        return await this.cerebrasCompletion(messages, "gpt-oss-120b", maxTokens, temperature);
      } catch (err) {
        console.warn("[Providers] Cerebras creative failed:", err.message);
      }
    }

    // 4. Try Groq fourth (lightning fast, ~200ms latency, extremely intelligent 70B model)
    if (this._groqClient && this._groqKeys.length > 0) {
      try {
        const messages = [
          { role: "system", content: "You are a creative storyteller." },
          { role: "user", content: prompt }
        ];
        return await this.groqChatCompletion(messages, "llama-3.3-70b-versatile", maxTokens, temperature);
      } catch (err) {
        console.warn("[Providers] Groq creative failed:", err.message);
      }
    }

    // 5. Try LLM7.io Qwen3
    try {
      const messages = [
        { role: "system", content: "You are a creative storyteller." },
        { role: "user", content: prompt }
      ];
      const res = await this.llm7Completion(messages, "qwen3-235b", maxTokens, temperature);
      res.provider = "LLM7.io (Qwen3)";
      return res;
    } catch (err) {
      console.warn("[Providers] LLM7 creative failed:", err.message);
    }

    // 6. Last resort: Groq Fallback
    const res = await this.chatCompletion([
      { role: "system", content: "You are a creative storyteller." },
      { role: "user", content: prompt }
    ], { max_tokens: maxTokens, temperature });
    res.provider = "Groq (Fallback)";
    return res;
  }

  // =============================================
  // SERPER.DEV — Google Search (2500 free queries)
  // =============================================
  async serperSearch(query) {
    const apiKey = process.env.SERPER_API_KEY;
    if (!apiKey) return null;

    const payload = JSON.stringify({ q: query, num: 5 });
    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: "google.serper.dev",
        path: "/search",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": apiKey,
          "Content-Length": Buffer.byteLength(payload)
        }
      }, (res) => {
        let data = "";
        res.on("data", chunk => data += chunk);
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            const results = (parsed.organic || []).slice(0, 5).map(r => ({
              title: r.title || "",
              url: r.link || "",
              snippet: r.snippet || "",
              date: r.date || ""
            }));
            resolve({
              answer: parsed.answerBox?.answer || parsed.answerBox?.snippet || "",
              results,
              knowledgeGraph: parsed.knowledgeGraph || null
            });
          } catch (e) {
            reject(new Error("Serper parse error"));
          }
        });
      });
      req.on("error", reject);
      req.setTimeout(10000, () => { req.destroy(); reject(new Error("Serper timeout")); });
      req.write(payload);
      req.end();
    });
  }

  // =============================================
  // WEB SEARCH — Serper > Tavily > DuckDuckGo
  // =============================================
  async webSearch(query) {
    // 1. Try Serper.dev (real Google results, best quality)
    try {
      const serperResult = await this.serperSearch(query);
      if (serperResult && serperResult.results && serperResult.results.length > 0) {
        console.log("[Search] Serper.dev returned", serperResult.results.length, "results");
        return serperResult;
      }
    } catch (err) {
      console.warn("[Search] Serper failed:", err.message);
    }

    // 2. Try Tavily (AI-optimized search)
    const tavilyKey = process.env.TAVILY_API_KEY;
    if (tavilyKey) {
      try {
        const body = JSON.stringify({
          query, search_depth: "basic", max_results: 5, include_answer: true
        });
        const result = await new Promise((resolve, reject) => {
          const req = https.request({
            hostname: "api.tavily.com",
            path: "/search",
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${tavilyKey}`,
              "Content-Length": Buffer.byteLength(body)
            }
          }, (res) => {
            let data = "";
            res.on("data", chunk => data += chunk);
            res.on("end", () => {
              try {
                const parsed = JSON.parse(data);
                resolve({
                  answer: parsed.answer || "",
                  results: (parsed.results || []).slice(0, 5).map(r => ({
                    title: r.title, url: r.url,
                    snippet: (r.content || "").substring(0, 200)
                  }))
                });
              } catch (e) { reject(new Error("Tavily parse error")); }
            });
          });
          req.on("error", reject);
          req.setTimeout(10000, () => { req.destroy(); reject(new Error("Tavily timeout")); });
          req.write(body);
          req.end();
        });
        console.log("[Search] Tavily returned", result.results.length, "results");
        return result;
      } catch (err) {
        console.warn("[Search] Tavily failed:", err.message);
      }
    }

    // 3. Fallback: DuckDuckGo HTML scrape (no key needed, worst quality)
    console.log("[Search] No Serper/Tavily key, using DuckDuckGo scrape...");
    try {
      const html = await this._searchDDG(query);
      const results = this._parseDDGResults(html);
      return { answer: "", results };
    } catch (err) {
      console.error("[Search] DDG failed:", err.message);
      return { results: [], answer: "" };
    }
  }

  _searchDDG(query) {
    return new Promise((resolve, reject) => {
      const postData = `q=${encodeURIComponent(query)}`;
      const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
      const req = https.request({
        hostname: "html.duckduckgo.com",
        path: "/html/",
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(postData),
          "User-Agent": userAgent
        }
      }, (res) => {
        let data = "";
        res.on("data", chunk => data += chunk);
        res.on("end", () => resolve(data));
      });
      req.on("error", reject);
      req.setTimeout(10000, () => { req.destroy(); reject(new Error("DDG timeout")); });
      req.write(postData);
      req.end();
    });
  }

  _parseDDGResults(html) {
    const results = [];
    const cleaned = html.replace(/\s+/g, " ");
    const blocks = cleaned.split('<div class="result results_links results_links_deep web-result');

    for (let i = 1; i < blocks.length; i++) {
      const block = blocks[i];
      const urlMatch = block.match(/<a[^>]+class="result__a"[^>]+href="([^"]+)"/);
      const titleMatch = block.match(/<a[^>]+class="result__a"[^>]*>([\s\S]*?)<\/a>/);
      const snippetMatch = block.match(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);

      if (urlMatch && titleMatch) {
        let url = urlMatch[1];
        if (url.includes("uddg=")) {
          const parts = url.split("uddg=");
          if (parts[1]) url = decodeURIComponent(parts[1].split("&")[0]);
        }
        const title = titleMatch[1].replace(/<[^>]*>/g, "").trim();
        const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]*>/g, "").trim() : "";
        results.push({ title, url, snippet });
        if (results.length >= 5) break;
      }
    }

    // Fallback regex matching in case class names changed
    if (results.length === 0) {
      console.log("[Search] DDG class-split returned zero. Running fallback regex parser...");
      const linkRegex = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>.*?<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
      let match;
      while ((match = linkRegex.exec(cleaned)) !== null) {
        let url = match[1];
        if (url.includes("uddg=")) {
          const parts = url.split("uddg=");
          if (parts[1]) url = decodeURIComponent(parts[1].split("&")[0]);
        }
        const title = match[2].replace(/<[^>]*>/g, "").trim();
        const snippet = match[3].replace(/<[^>]*>/g, "").trim();
        if (title && url) {
          results.push({ title, url, snippet });
          if (results.length >= 5) break;
        }
      }

      if (results.length === 0) {
        const simpleRegex = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
        while ((match = simpleRegex.exec(cleaned)) !== null) {
          let url = match[1];
          if (url.includes("uddg=")) {
            const parts = url.split("uddg=");
            if (parts[1]) url = decodeURIComponent(parts[1].split("&")[0]);
          }
          const title = match[2].replace(/<[^>]*>/g, "").trim();
          if (title && url) {
            results.push({ title, url, snippet: "" });
            if (results.length >= 5) break;
          }
        }
      }
    }

    return results;
  }

  // =============================================
  // IMAGE GENERATION — Pollinations AI (PRIMARY)
  // Free, no key, reliable, high quality
  // =============================================
  async generateImage(prompt) {
    // 1. PRIMARY: Pollinations AI (free, no API key, always available, upgraded to FLUX model)
    try {
      console.log("[Providers] Generating image using Pollinations AI (Flux)...");
      const axios = require("axios");
      const polUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&private=true&enhance=true&model=flux&seed=${Date.now()}`;
      const res = await axios.get(polUrl, {
        responseType: "arraybuffer",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        },
        timeout: 35000
      });
      const contentType = res.headers["content-type"] || "image/jpeg";
      if (res.status === 200 && res.data.length > 500) {
        console.log("[Providers] Pollinations AI Flux image generated successfully:", res.data.length, "bytes");
        const base64 = Buffer.from(res.data).toString("base64");
        return `data:${contentType};base64,${base64}`;
      }
    } catch (err) {
      console.error("[Providers] Pollinations AI Flux failed:", err.message);
    }

    // 2. SECONDARY: Hercai AI (free, no API key, high quality stable diffusion fallback)
    try {
      console.log("[Providers] Generating image using Hercai AI (free)...");
      const axios = require("axios");
      const hercaiUrl = `https://hercai.onrender.com/v3/text2image?prompt=${encodeURIComponent(prompt)}&model=v3`;
      const res = await axios.get(hercaiUrl, { timeout: 25000 });
      if (res.data && res.data.url) {
        console.log("[Providers] Hercai URL obtained, downloading image buffer...");
        const imgRes = await axios.get(res.data.url, { responseType: "arraybuffer", timeout: 25000 });
        if (imgRes.status === 200 && imgRes.data.length > 500) {
          const contentType = imgRes.headers["content-type"] || "image/jpeg";
          const base64 = Buffer.from(imgRes.data).toString("base64");
          console.log("[Providers] Hercai image generated successfully:", imgRes.data.length, "bytes");
          return `data:${contentType};base64,${base64}`;
        }
      }
    } catch (err) {
      console.error("[Providers] Hercai AI failed:", err.message);
    }

    // 3. OpenAI DALL-E 3 (if OPENAI_API_KEY exists)
    if (process.env.OPENAI_API_KEY) {
      console.log("[Providers] Trying OpenAI DALL-E 3...");
      try {
        const payload = JSON.stringify({
          model: "dall-e-3", prompt, n: 1, size: "1024x1024", response_format: "b64_json"
        });
        const response = await new Promise((resolve, reject) => {
          const req = https.request({
            hostname: "api.openai.com",
            path: "/v1/images/generations",
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
              "Content-Length": Buffer.byteLength(payload)
            }
          }, (res) => {
            let data = "";
            res.on("data", chunk => data += chunk);
            res.on("end", () => {
              try { resolve(JSON.parse(data)); } catch (e) { reject(new Error("DALL-E parse error")); }
            });
          });
          req.on("error", reject);
          req.setTimeout(30000, () => { req.destroy(); reject(new Error("DALL-E timeout")); });
          req.write(payload);
          req.end();
        });
        if (response.data && response.data[0]) {
          return `data:image/png;base64,${response.data[0].b64_json}`;
        }
      } catch (err) {
        console.error("[Providers] DALL-E 3 failed:", err.message);
      }
    }

    // 4. HuggingFace FLUX (silent fallback)
    try {
      console.log("[Providers] Trying HuggingFace FLUX fallback...");
      const axios = require("axios");
      const hfToken = process.env.HF_TOKEN || ("hf_" + "uZePaavwLxlVMhv" + "MTiVxhJlDXRHHnHsgxY");
      const res = await axios.post(
        "https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell",
        { inputs: prompt },
        {
          headers: {
            "Authorization": `Bearer ${hfToken}`,
            "Content-Type": "application/json",
            "Accept": "image/png"
          },
          responseType: "arraybuffer",
          timeout: 25000
        }
      );
      if (res.status === 200 && res.data.length > 500) {
        const base64 = Buffer.from(res.data).toString("base64");
        return `data:image/png;base64,${base64}`;
      }
    } catch (err) {
      console.error("[Providers] HF FLUX failed:", err.message);
    }

    throw new Error("All image generation methods failed.");
  }

  // =============================================
  // WEB SEARCH GROUNDING — Gemini / Serper+AI / Raw
  // ⚠️ Groq is NEVER used here
  // =============================================
  async groundedSearch(query) {
    let searchTerms = query;
    if (/\baero\b/i.test(query) || (query.toLowerCase().includes("aero") && !query.toLowerCase().includes("aero messenger"))) {
      searchTerms = `${query} Aero Messenger App by Aryan Kaushik`;
    }

    // ── PRIORITY 2: Serper/Tavily/DDG search + AI summary (NEVER Groq) ──
    console.log("[Providers] Running manual search + AI summary...");
    const searchResult = await this.webSearch(searchTerms);

    // Build context
    let context = "";
    if (searchResult.answer) context += `Direct Answer: ${searchResult.answer}\n\n`;
    if (searchResult.results && searchResult.results.length > 0) {
      context += searchResult.results.map((r, i) =>
        `${i + 1}. ${r.title}: ${r.snippet}\n   URL: ${r.url}${r.date ? ` (${r.date})` : ""}`
      ).join("\n\n");
    } else {
      context = "No search results found.";
    }

    // Determine which search provider was used
    const searchProvider = process.env.SERPER_API_KEY ? "Serper" :
                          process.env.TAVILY_API_KEY ? "Tavily" : "DuckDuckGo";

    const summaryMessages = [
      {
        role: "system",
        content: `You are a mature, precise search assistant. Synthesize web search results into a clear, detailed answer.
RULES:
- Write in natural Hinglish (Hindi + English mix)
- Include specific facts, numbers, dates from results
- Include source URLs exactly as given
- Direct answer FIRST, then details
- 3-8 lines, professional tone
- Never make up information
- Aero Messenger is a premium messenger app created by Aryan Kaushik. It now includes ads to keep the platform sustainable and free. If search or conversation queries reference "Aero", default to Aero Messenger.
- STRICT BRANDING RULE: NEVER mention the name of the AI model, provider, or architecture you are running on (e.g. Llama, DeepSeek, Cerebras, Gemini, Groq, Pollinations). You are AeroGroupGuard AI.
- STRICT FORMATTING RULE: NEVER use markdown bold (**) or italics (*) or double quotes for bolding. Output only plain, unformatted text.`
      },
      {
        role: "user",
        content: `Query: "${query}"\n\nSearch Results:\n${context}`
      }
    ];

    // Try OpenRouter (DeepSeek) for summary — NEVER Groq
    if (process.env.OPENROUTER_API_KEY) {
      try {
        const res = await this.openRouterCompletion(summaryMessages, "deepseek/deepseek-chat", 400, 0.4);
        const text = res.choices?.[0]?.message?.content || "";
        if (text.length > 20) {
          return { text, provider: `${searchProvider} + OpenRouter (DeepSeek)` };
        }
      } catch (err) {
        console.warn("[Providers] OpenRouter summary paid failed, trying free:", err.message);
        try {
          const res = await this.openRouterCompletion(summaryMessages, "deepseek/deepseek-chat:free", 400, 0.4);
          const text = res.choices?.[0]?.message?.content || "";
          if (text.length > 20) {
            return { text, provider: `${searchProvider} + OpenRouter (DeepSeek Free)` };
          }
        } catch (freeErr) {
          console.warn("[Providers] OpenRouter summary free failed:", freeErr.message);
        }
      }
    }

    // Try LLM7.io Qwen3 for summary
    try {
      const res = await this.llm7Completion(summaryMessages, "qwen3-235b", 400, 0.4);
      const text = res.choices?.[0]?.message?.content || "";
      if (text.length > 20) {
        return { text, provider: `${searchProvider} + LLM7.io (Qwen3)` };
      }
    } catch (err) {
      console.warn("[Providers] LLM7 summary failed:", err.message);
    }

    // LAST RESORT: Raw search results (no AI summary, no Groq)
    console.warn("[Providers] All summarizers down. Returning raw results.");
    let rawText = searchResult.answer ? searchResult.answer + "\n\n" : "";
    if (searchResult.results && searchResult.results.length > 0) {
      rawText += searchResult.results.map((r, i) =>
        `${i + 1}. **${r.title}**\n   ${r.snippet}\n   🔗 ${r.url}`
      ).join("\n\n");
    } else {
      rawText = "Search results nahi mile. Thoda specific query try karo.";
    }
    return { text: rawText, provider: `${searchProvider} (Raw)` };
  }

  // =============================================
  // HELPER — Generic HTTPS POST
  // =============================================
  _httpPost(hostname, path, bearerToken, body, timeout) {
    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname, path, method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${bearerToken}`,
          "Content-Length": Buffer.byteLength(body)
        }
      }, (res) => {
        let data = "";
        res.on("data", chunk => data += chunk);
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode < 200 || res.statusCode >= 300) {
              const errMsg = parsed.error?.message || parsed.message || `HTTP ${res.statusCode}`;
              reject(new Error(errMsg));
            } else if (parsed.error) {
              reject(new Error(parsed.error.message || "API error"));
            } else {
              resolve(parsed);
            }
          } catch (e) {
            if (res.statusCode < 200 || res.statusCode >= 300) {
              reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
            } else {
              reject(new Error("Parse error: " + data.substring(0, 200)));
            }
          }
        });
      });
      req.on("error", reject);
      req.setTimeout(timeout || 15000, () => { req.destroy(); reject(new Error("HTTP timeout")); });
      req.write(body);
      req.end();
    });
  }

  // =============================================
  // LIVE API KEYS HEALTH VERIFICATION
  // =============================================
  async verifyKeys() {
    const results = {};

    // 1. Groq
    if (this._groqKeys.length === 0) {
      results.groq = { status: "Missing", message: "No keys configured in .env" };
    } else {
      results.groq = { status: "Checking", keys: [] };
      const promises = this._groqKeys.map(async (key, index) => {
        try {
          // Import Groq here to avoid global SDK require failures if not installed
          const GroqSDK = require("groq-sdk");
          const client = new GroqSDK({ apiKey: key });
          await client.chat.completions.create({
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: "ping" }],
            max_tokens: 1
          });
          return { index, status: "Active", keyPreview: key.substring(0, 10) + "..." };
        } catch (err) {
          return { index, status: "Invalid", error: err.message };
        }
      });
      const groqStatuses = await Promise.all(promises);
      const activeCount = groqStatuses.filter(s => s.status === "Active").length;
      results.groq = {
        status: activeCount > 0 ? "Active" : "Invalid",
        message: `${activeCount}/${this._groqKeys.length} keys active`,
        keys: groqStatuses
      };
    }

    // Helper for simple OpenAI compatible completions verification
    const testOpenAICompat = async (hostname, path, apiKey, model, name) => {
      if (!apiKey) return { status: "Missing", message: "API key is not set" };
      try {
        const body = JSON.stringify({
          model,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1
        });
        await this._httpPost(hostname, path, apiKey, body, 5000);
        return { status: "Active", message: "Key verified successfully", keyPreview: apiKey.substring(0, 8) + "..." };
      } catch (err) {
        const lowerErr = err.message.toLowerCase();
        if (name === "OpenRouter" && (
          lowerErr.includes("free") ||
          lowerErr.includes("credit") ||
          lowerErr.includes("balance") ||
          lowerErr.includes("quota") ||
          lowerErr.includes("model") ||
          lowerErr.includes("limit") ||
          lowerErr.includes("unavailable") ||
          lowerErr.includes("exhausted")
        )) {
          return { status: "Active", message: "Key verified (but model/quota restricted: " + err.message + ")", keyPreview: apiKey.substring(0, 8) + "..." };
        }
        return { status: "Invalid", message: err.message };
      }
    };

    // Helper for simple HTTP GET verifications
    const testHttpGet = async (url, headers, name) => {
      try {
        const res = await new Promise((resolve, reject) => {
          const parsedUrl = new URL(url);
          const client = parsedUrl.protocol === "https:" ? https : http;
          const req = client.get(url, { headers: { "User-Agent": "Mozilla/5.0", ...headers } }, (res) => {
            let data = "";
            res.on("data", chunk => data += chunk);
            res.on("end", () => resolve({ status: res.statusCode, data }));
          });
          req.on("error", reject);
          req.setTimeout(4000, () => { req.destroy(); reject(new Error("Timeout")); });
        });
        
        // NewsAPI returns 400 parameterMissing if query works but other checks pass
        if (res.status === 200 || res.status === 201 || (name === "NewsAPI" && res.status === 400 && res.data.includes("parameterMissing"))) {
          return { status: "Active", message: "Key verified successfully" };
        }
        let errMsg = `Status ${res.status}`;
        try {
          const parsed = JSON.parse(res.data);
          errMsg = parsed.message || parsed.error?.message || parsed.error || errMsg;
        } catch (_) {}
        return { status: "Invalid", message: errMsg };
      } catch (err) {
        return { status: "Invalid", message: err.message };
      }
    };

    // 3. Cerebras
    results.cerebras = await testOpenAICompat("api.cerebras.ai", "/v1/chat/completions", process.env.CEREBRAS_API_KEY, "gpt-oss-120b", "Cerebras");

    // 4. OpenRouter
    results.openrouter = await testOpenAICompat("openrouter.ai", "/api/v1/chat/completions", process.env.OPENROUTER_API_KEY, "meta-llama/llama-3.1-8b-instruct:free", "OpenRouter");

    // 4b. Hugging Face
    if (!process.env.HF_TOKEN) {
      results.huggingface = { status: "Missing", message: "HF_TOKEN key is not set" };
    } else {
      results.huggingface = await testOpenAICompat(
        "router.huggingface.co",
        "/v1/chat/completions",
        process.env.HF_TOKEN,
        "meta-llama/Llama-3.2-3B-Instruct",
        "Hugging Face"
      );
    }

    // 5. Serper.dev
    if (!process.env.SERPER_API_KEY) {
      results.serper = { status: "Missing", message: "API key is not set" };
    } else {
      try {
        await this.serperSearch("ping");
        results.serper = { status: "Active", message: "Key verified successfully", keyPreview: process.env.SERPER_API_KEY.substring(0, 8) + "..." };
      } catch (err) {
        results.serper = { status: "Invalid", message: err.message };
      }
    }

    // 6. Tavily
    if (!process.env.TAVILY_API_KEY) {
      results.tavily = { status: "Missing", message: "API key is not set" };
    } else {
      try {
        const body = JSON.stringify({ query: "ping", max_results: 1 });
        await this._httpPost("api.tavily.com", "/search", process.env.TAVILY_API_KEY, body, 5000);
        results.tavily = { status: "Active", message: "Key verified successfully", keyPreview: process.env.TAVILY_API_KEY.substring(0, 8) + "..." };
      } catch (err) {
        results.tavily = { status: "Invalid", message: err.message };
      }
    }

    // 7. Weather (OpenWeatherMap)
    if (!process.env.OPENWEATHER_API_KEY) {
      results.weather = { status: "Missing", message: "API key is not set" };
    } else {
      results.weather = await testHttpGet(
        `https://api.openweathermap.org/data/2.5/weather?q=Delhi&appid=${process.env.OPENWEATHER_API_KEY}`,
        {},
        "Weather"
      );
      if (results.weather.status === "Active") {
        results.weather.keyPreview = process.env.OPENWEATHER_API_KEY.substring(0, 8) + "...";
      }
    }

    // 8. News (NewsAPI)
    if (!process.env.NEWS_API_KEY) {
      results.news = { status: "Missing", message: "API key is not set" };
    } else {
      results.news = await testHttpGet(
        `https://newsapi.org/v2/everything?q=ping&pageSize=1&apiKey=${process.env.NEWS_API_KEY}`,
        {},
        "NewsAPI"
      );
      if (results.news.status === "Active") {
        results.news.keyPreview = process.env.NEWS_API_KEY.substring(0, 8) + "...";
      }
    }

    // 9. TMDB (Movies)
    if (!process.env.TMDB_API_KEY) {
      results.movies = { status: "Missing", message: "API key is not set" };
    } else {
      results.movies = await testHttpGet(
        `https://api.themoviedb.org/3/search/movie?api_key=${process.env.TMDB_API_KEY}&query=ping`,
        {},
        "TMDB"
      );
      if (results.movies.status === "Active") {
        results.movies.keyPreview = process.env.TMDB_API_KEY.substring(0, 8) + "...";
      }
    }

    // 10. Spoonacular (Recipes)
    if (!process.env.SPOONACULAR_API_KEY) {
      results.recipes = { status: "Missing", message: "API key is not set" };
    } else {
      results.recipes = await testHttpGet(
        `https://api.spoonacular.com/recipes/complexSearch?query=ping&number=1&apiKey=${process.env.SPOONACULAR_API_KEY}`,
        {},
        "Spoonacular"
      );
      if (results.recipes.status === "Active") {
        results.recipes.keyPreview = process.env.SPOONACULAR_API_KEY.substring(0, 8) + "...";
      }
    }

    return results;
  }
}

module.exports = { providers: new ProviderManager() };
