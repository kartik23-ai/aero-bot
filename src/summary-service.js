"use strict";

function summarizeSevenDays(chatHistory = [], moderationActions = []) {
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = chatHistory.filter((entry) => {
    const timestamp = new Date(entry.timestamp || entry.createdAt || 0).getTime();
    return Number.isFinite(timestamp) && timestamp >= sevenDaysAgo && entry.text;
  });

  if (recent.length < 3) return "Not enough chat history available for a 7-day summary.";

  const memberCounts = new Map();
  for (const entry of recent) {
    if (entry.senderId) memberCounts.set(entry.senderId, (memberCounts.get(entry.senderId) || 0) + 1);
  }
  const activeMembers = [...memberCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, count]) => `${id} (${count})`);

  const lines = recent.map((entry) => entry.text);
  const pick = (pattern) => lines.filter((line) => pattern.test(line)).slice(0, 3);
  const topics = topTerms(lines);

  return [
    "7-day recap:",
    `Topics: ${topics.join(", ") || "general discussion"}.`,
    `Most active: ${activeMembers.join(", ") || "not available"}.`,
    `Unresolved issues: ${format(pick(/\b(issue|problem|complaint|pending|unresolved|broken)\b/i))}`,
    `Decisions: ${format(pick(/\b(decided|approved|agreed|confirmed|final)\b/i))}`,
    `Announcements: ${format(pick(/\b(announcement|notice|reminder|event|launch)\b/i))}`,
    `Moderation: ${moderationActions.length ? moderationActions.slice(0, 5).map((a) => a.action).join(", ") : "none noted."}`
  ].join("\n");
}

function topTerms(lines) {
  const stop = new Set(["this", "that", "with", "from", "have", "will", "admin", "please", "group"]);
  const counts = new Map();
  for (const line of lines) {
    for (const word of line.toLowerCase().match(/\b[a-z][a-z0-9]{3,}\b/g) || []) {
      if (!stop.has(word)) counts.set(word, (counts.get(word) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([word]) => word);
}

function format(items) {
  return items.length ? items.join(" | ") : "none noted.";
}

module.exports = { summarizeSevenDays };
