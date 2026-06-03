"use strict";

const crypto = require("node:crypto");

function validateWebhookSignature(rawBody, signature, secret) {
  if (!secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(signature || ""), Buffer.from(expected));
}

function createRateLimiter({ limit, windowMs }) {
  const buckets = new Map();
  return function rateLimit(key) {
    const now = Date.now();
    const current = buckets.get(key) || { count: 0, resetAt: now + windowMs };
    if (now > current.resetAt) {
      current.count = 0;
      current.resetAt = now + windowMs;
    }
    current.count += 1;
    buckets.set(key, current);
    return current.count <= limit;
  };
}

function sanitizeText(value, maxLength = 4000) {
  return String(value || "").replace(/[\u0000-\u001F\u007F]/g, "").slice(0, maxLength).trim();
}

module.exports = { validateWebhookSignature, createRateLimiter, sanitizeText };
