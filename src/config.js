"use strict";

const config = Object.freeze({
  env: process.env.NODE_ENV || "development",
  port: Number.parseInt(process.env.PORT || "7860", 10),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || "http://localhost:8080",
  aeroApiBaseUrl: process.env.AERO_API_BASE_URL || "",
  aeroClientId: process.env.AERO_CLIENT_ID || "",
  aeroClientSecret: process.env.AERO_CLIENT_SECRET || "",
  jwtSecret: process.env.JWT_SECRET || "dev-only-change-me",
  databaseUrl: process.env.DATABASE_URL || "",
  redisUrl: process.env.REDIS_URL || "",
  openAiApiKey: process.env.OPENAI_API_KEY || "",
  groqApiKey: process.env.GROQ_API_KEY || "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",
  aiModel: process.env.AI_MODEL || "llama-3.3-70b-versatile",
  rateLimitPerMinute: Number.parseInt(process.env.RATE_LIMIT_PER_MINUTE || "120", 10)
});

module.exports = { config };
