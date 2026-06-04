"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { AeroGroupGuard } = require("../src/aero-group-guard");

const groupContext = {
  enabled: true,
  isGroup: true,
  groupName: "Flight Crew"
};

test("denies admin commands for regular users", () => {
  const bot = new AeroGroupGuard({ ownerId: "owner" });
  const result = bot.handleMessage(
    { text: "/ban @sam spam", sender: { id: "user" } },
    groupContext
  );

  assert.equal(result, "Permission denied. Admin only.");
  assert.equal(bot.logs.at(-1).payload.reason, "permission_denied");
});

test("allows admins to mute when target and duration are present", () => {
  const bot = new AeroGroupGuard({ ownerId: "owner" });
  const calls = [];
  const result = bot.handleMessage(
    { text: "/mute @sam 10m spam", sender: { id: "admin", isPlatformAdmin: true } },
    {
      ...groupContext,
      platformActions: {
        mute: (payload) => calls.push(payload)
      }
    }
  );

  assert.equal(result, "@sam has been muted for 10 minutes: spam.");
  assert.deepEqual(calls, [{ target: "@sam", reason: "spam" }]);
});

test("asks for required target or duration", () => {
  const bot = new AeroGroupGuard({ ownerId: "owner" });

  assert.equal(
    bot.handleMessage({ text: "/kick", sender: { id: "owner" } }, groupContext),
    "Please specify a user to kick."
  );
  assert.equal(
    bot.handleMessage({ text: "/mute @sam", sender: { id: "owner" } }, groupContext),
    "Please specify a mute duration."
  );
});

test("falls back when platform cannot perform moderation action", () => {
  const bot = new AeroGroupGuard({ ownerId: "owner" });
  const result = bot.handleMessage(
    { text: "/kick @sam spam", sender: { id: "owner" } },
    groupContext
  );

  assert.equal(result, "Cannot kick @sam on this platform. Admins should review manually.");
});

test("supports user commands and keyword triggers", () => {
  const bot = new AeroGroupGuard({ ownerId: "owner" });

  assert.equal(
    bot.handleMessage({ text: "/rules", sender: { id: "user" } }, groupContext),
    "Be respectful, no spam, and use commands responsibly."
  );
  assert.equal(
    bot.handleMessage({ text: "can someone call admin?", sender: { id: "user" } }, groupContext),
    "Admin attention needed: User requested admin attention."
  );
  assert.equal(
    bot.handleMessage({ text: "@xenonn hello there", sender: { id: "user" } }, groupContext),
    null
  );
  assert.equal(
    bot.handleMessage({ text: "@rules", sender: { id: "user" } }, groupContext),
    null
  );

  // Test with prefix "@"
  const botWithAtPrefix = new AeroGroupGuard({ ownerId: "owner", prefix: "@" });
  assert.equal(
    botWithAtPrefix.handleMessage({ text: "@rules", sender: { id: "user" } }, groupContext),
    "Be respectful, no spam, and use commands responsibly."
  );
  assert.equal(
    botWithAtPrefix.handleMessage({ text: "@xenonn hello there", sender: { id: "user" } }, groupContext),
    null
  );
  assert.equal(
    botWithAtPrefix.handleMessage({ text: "/rules", sender: { id: "user" } }, groupContext),
    "Be respectful, no spam, and use commands responsibly."
  );
});

test("activates on bot mention without slash command", () => {
  const bot = new AeroGroupGuard({ ownerId: "owner", botMention: "@AeroGroupGuard" });

  assert.match(
    bot.handleMessage({ text: "@AeroGroupGuard help", sender: { id: "user" } }, groupContext),
    /User commands:/
  );
  assert.match(
    bot.handleMessage({ text: "@AeroGroupGuard faq", sender: { id: "user" } }, groupContext),
    /FAQ:/
  );
});

test("assistant-only mode blocks destructive actions even for owner", () => {
  const bot = new AeroGroupGuard({ ownerId: "owner" });
  const result = bot.handleMessage(
    { text: "/ban @sam spam", sender: { id: "owner" } },
    { ...groupContext, assistantOnly: true }
  );

  assert.equal(result, "This bot is in assistant mode. Moderation actions are disabled.");
});

test("welcomes new members with group name when available", () => {
  const bot = new AeroGroupGuard({ ownerId: "owner" });
  const result = bot.handleMemberJoin(
    { id: "new-user", mention: "@newuser" },
    groupContext
  );

  assert.equal(
    result,
    "Welcome to the group, @newuser! Be respectful, avoid spam, and check /rules. Group: Flight Crew."
  );
});

test("ignores private messages unless enabled", () => {
  const bot = new AeroGroupGuard({ ownerId: "owner" });

  assert.equal(
    bot.handleMessage({ text: "/help", sender: { id: "user" } }, { enabled: true, isGroup: false }),
    null
  );
});

test("generates short 7-day summary for admins", () => {
  const bot = new AeroGroupGuard({ ownerId: "owner" });
  const now = new Date().toISOString();
  const result = bot.handleMessage(
    { text: "/summary", sender: { id: "owner" } },
    {
      ...groupContext,
      chatHistory: [
        { timestamp: now, text: "Reminder: event starts Friday" },
        { timestamp: now, text: "We agreed final rules for launch" },
        { timestamp: now, text: "Pending task: need to update pinned post" },
        { timestamp: now, text: "Complaint about spam delay" }
      ]
    }
  );

  assert.match(result, /^7-day summary:/);
  assert.match(result, /Main topics:/);
  assert.match(result, /Decisions:/);
  assert.match(result, /Issues:/);
});

test("blocks summary for regular users", () => {
  const bot = new AeroGroupGuard({ ownerId: "owner" });
  const result = bot.handleMessage(
    { text: "/chatrecap", sender: { id: "user" } },
    groupContext
  );

  assert.equal(result, "Permission denied. Admin only.");
});

test("recognizes draw, faq, rename, announce, setfaq commands in handleMessage", () => {
  const bot = new AeroGroupGuard({ ownerId: "owner" });
  
  assert.equal(
    bot.handleMessage({ text: "/rename New Group", sender: { id: "user" } }, groupContext),
    "Permission denied. Admin only."
  );
  assert.equal(
    bot.handleMessage({ text: "/announce Hello", sender: { id: "user" } }, groupContext),
    "Permission denied. Admin only."
  );
  assert.equal(
    bot.handleMessage({ text: "/setfaq Text", sender: { id: "user" } }, groupContext),
    "Permission denied. Admin only."
  );
  
  assert.equal(
    bot.handleMessage({ text: "/draw a cat", sender: { id: "user" } }, groupContext),
    "Unknown command. Type /help."
  );
});
