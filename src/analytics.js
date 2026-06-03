"use strict";

function buildAnalytics(events = []) {
  const byDay = new Map();
  const languages = new Map();
  const moderation = new Map();
  const users = new Set();

  for (const event of events) {
    const day = new Date(event.timestamp || event.at || Date.now()).toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) || 0) + 1);
    if (event.userId) users.add(event.userId);
    if (event.language) languages.set(event.language, (languages.get(event.language) || 0) + 1);
    if (event.type === "moderation") moderation.set(event.action, (moderation.get(event.action) || 0) + 1);
  }

  return {
    activeUsers: users.size,
    messagesPerDay: Object.fromEntries(byDay),
    moderationActions: Object.fromEntries(moderation),
    languageDistribution: Object.fromEntries(languages),
    growthMetrics: { newMembers7d: events.filter((e) => e.type === "member_join").length },
    engagementMetrics: { totalEvents: events.length }
  };
}

module.exports = { buildAnalytics };
