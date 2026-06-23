"use strict";

const PermissionLevel = Object.freeze({
  OWNER: "OWNER",
  ADMIN: "ADMIN",
  USER: "USER"
});

const DEFAULTS = Object.freeze({
  prefix: "/",
  welcomeEnabled: true,
  rules: "Be respectful, no spam, and use commands responsibly.",
  welcomeMessage: "Welcome to the group, @user! Be respectful, avoid spam, and check /rules.",
  adminAlert: "Admin attention needed: [reason]",
  faq: "FAQ: Use /rules for rules, /report for issues, and mention @AeroGroupGuard help for assistance."
});

const ADMIN_COMMANDS = new Set([
  "kick",
  "ban",
  "mute",
  "unmute",
  "warn",
  "clearwarns",
  "setwelcome",
  "setrules",
  "setprefix",
  "lock",
  "unlock",
  "lockgroup",
  "unlockgroup",
  "slowmode",
  "slow5",
  "slowmode5",
  "slow10",
  "slowmode10",
  "slowoff",
  "slowmodeoff",
  "slow0",
  "slowmode0",
  "aislow",
  "aislowmode",
  "purge",
  "reportreview",
  "summary",
  "weeklysummary",
  "chatrecap",
  "recap",
  "rename",
  "announce",
  "setfaq",
  "digest"
]);

const USER_COMMANDS = new Set([
  "help",
  "rules",
  "report",
  "admin",
  "info",
  "faq",
  "tagbot",
  "status",
  "commands",
  "summaryrequest",
  "draw",
  "meme",
  "remind"
]);

class AeroGroupGuard {
  constructor(options = {}) {
    this.ownerId = options.ownerId || null;
    this.botMention = normalizeMention(options.botMention || "@AeroGroupGuard");
    this.config = {
      prefix: options.prefix || DEFAULTS.prefix,
      welcomeEnabled: options.welcomeEnabled !== false,
      rules: options.rules || DEFAULTS.rules,
      welcomeMessage: options.welcomeMessage || DEFAULTS.welcomeMessage,
      allowPrivateMessages: options.allowPrivateMessages === true,
      locked: false,
      slowmodeSeconds: 0,
      aiSlowmodeSec: 0
    };
    this.faq = options.faq || DEFAULTS.faq;
    this.warns = new Map();
    this.logs = [];
  }

  handleMessage(message, context = {}) {
    if (!this.shouldHandleMessage(message, context)) {
      return null;
    }

    const parsed = this.parseCommand(message.text || "");
    if (parsed) {
      return this.handleCommand(parsed, message, context);
    }

    const mentionIntent = this.parseMentionIntent(message.text || "");
    if (mentionIntent) {
      return this.handleMentionIntent(mentionIntent, message, context);
    }

    return this.handleKeyword(message, context);
  }

  handleMemberJoin(member, context = {}) {
    if (!context.isGroup || !context.enabled || !this.config.welcomeEnabled) {
      return null;
    }

    const userMention = member?.mention || mentionFromUser(member);
    const text = this.config.welcomeMessage
      .replaceAll("@user", userMention)
      .replaceAll("[group]", context.groupName || "the group");
    const groupNote = context.groupName ? ` Group: ${context.groupName}.` : "";

    this.log("welcome", { userId: member?.id, ok: true });
    return `${text}${groupNote}`;
  }

  shouldHandleMessage(message, context) {
    if (!context.enabled) return false;
    if (!context.isGroup && !this.config.allowPrivateMessages) return false;
    return Boolean(message?.text);
  }

  parseCommand(text) {
    const trimmed = text.trim();
    const prefix = escapeRegExp(this.config.prefix);
    // Allow either the configured prefix or the fallback / prefix
    const allowedPrefix = `(?:${prefix}|\\/)`;
    const commandPattern = new RegExp(`^${allowedPrefix}([\\w]+)(?:@\\S+)?(?:\\s+(.*))?$`, "i");
    const commandMatch = trimmed.match(commandPattern);

    if (commandMatch) {
      const cmdName = commandMatch[1].toLowerCase();
      
      // If the message starts with '@' (commonly used to tag other users),
      // only treat it as a command if it's a known bot command or the bot's username.
      if (trimmed.startsWith("@")) {
        const botName = this.botMention.replace(/^@/, "").toLowerCase();
        const isKnown = ADMIN_COMMANDS.has(cmdName) || USER_COMMANDS.has(cmdName) || cmdName === botName;
        if (!isKnown) {
          return null;
        }
      }

      const botName = this.botMention.replace(/^@/, "").toLowerCase();
      if (cmdName !== botName) {
        return {
          name: cmdName,
          argsText: (commandMatch[2] || "").trim()
        };
      }
    }

    // Match bot mention followed by optional command prefix and a command word
    // prefix is optional (?) which allows matching "@AeroGroupGuard faq" or "@AeroGroupGuard /faq"
    const mentionPattern = new RegExp(`^${escapeRegExp(this.botMention)}\\s+(?:(?:${prefix}|\\/))?([\\w]+)(?:\\s+(.*))?$`, "i");
    const mentionMatch = trimmed.match(mentionPattern);
    if (!mentionMatch) return null;

    const commandName = mentionMatch[1].toLowerCase();
    const hasExplicitPrefix = trimmed.match(new RegExp(`^${escapeRegExp(this.botMention)}\\s+(?:${prefix}|\\/)`, "i"));
    const isKnownCommand = ADMIN_COMMANDS.has(commandName) || USER_COMMANDS.has(commandName);

    if (hasExplicitPrefix || isKnownCommand) {
      return {
        name: commandName,
        argsText: (mentionMatch[2] || "").trim()
      };
    }

    return null;
  }

  parseMentionIntent(text) {
    const trimmed = text.trim();
    const mention = this.botMention.toLowerCase();
    if (!trimmed.toLowerCase().startsWith(mention)) return null;

    const intentText = trimmed.slice(this.botMention.length).trim();
    if (!intentText) return { name: "help", argsText: "" };
    if (intentText.startsWith(this.config.prefix) || intentText.startsWith("/")) return null;

    const [name, ...rest] = intentText.split(/\s+/);
    return {
      name: normalizeIntentName(name),
      argsText: rest.join(" ").trim()
    };
  }

  handleCommand(parsed, message, context) {
    const level = this.getPermissionLevel(message.sender, context);

    if (context.assistantOnly && ADMIN_COMMANDS.has(parsed.name) && !["summary", "weeklysummary", "chatrecap", "recap"].includes(parsed.name)) {
      this.log(parsed.name, { ok: false, reason: "assistant_only_blocked" });
      return "This bot is in assistant mode. Moderation actions are disabled.";
    }

    if (ADMIN_COMMANDS.has(parsed.name) && !isPrivileged(level)) {
      this.log(parsed.name, { ok: false, reason: "permission_denied" });
      return "Permission denied. Admin only.";
    }

    if (!ADMIN_COMMANDS.has(parsed.name) && !USER_COMMANDS.has(parsed.name)) {
      this.log(parsed.name, { ok: false, reason: "unknown_command" });
      return "Unknown command. Type /help.";
    }

    return ADMIN_COMMANDS.has(parsed.name)
      ? this.handleAdminCommand(parsed, message, context)
      : this.handleUserCommand(parsed, message, context);
  }

  handleAdminCommand(parsed, message, context) {
    const target = extractTarget(parsed.argsText);
    const reason = extractReason(parsed.argsText);

    switch (parsed.name) {
      case "kick":
        if (!target) return "Please specify a user to kick.";
        return this.runPlatformAction(context, "kick", target, reason, `${target} has been kicked${withReason(reason)}.`);
      case "ban":
        if (!target) return "Please specify a user to ban.";
        return this.runPlatformAction(context, "ban", target, reason, `${target} has been banned${withReason(reason)}.`);
      case "mute": {
        if (!target) return "Please specify a user to mute.";
        const duration = extractDuration(parsed.argsText);
        if (!duration) return "Please specify a mute duration.";
        const muteReason = extractReason(parsed.argsText, { skipDuration: true });
        return this.runPlatformAction(
          context,
          "mute",
          target,
          muteReason,
          `${target} has been muted for ${duration.label}${withReason(muteReason)}.`
        );
      }
      case "unmute":
        if (!target) return "Please specify a user to unmute.";
        return this.runPlatformAction(context, "unmute", target, "", `${target} has been unmuted.`);
      case "warn":
        if (!target) return "Please specify a user to warn.";
        return this.warnUser(target, reason);
      case "clearwarns":
        if (!target) return "Please specify a user to clear warnings for.";
        this.warns.delete(target);
        this.log("clearwarns", { target, ok: true });
        return `Warnings cleared for ${target}.`;
      case "setwelcome":
        return this.setWelcome(parsed.argsText);
      case "setrules":
        return this.setRules(parsed.argsText);
      case "setprefix":
        return this.setPrefix(parsed.argsText);
      case "lock":
      case "lockgroup":
        return this.setGroupLock(parsed.argsText || "on");
      case "unlock":
      case "unlockgroup":
        this.config.locked = false;
        this.log("unlock", { ok: true });
        return "Group unlocked.";
      case "slowmode":
        return this.setSlowmode(parsed.argsText);
      case "slow5":
      case "slowmode5":
        return this.setSlowmode("5");
      case "slow10":
      case "slowmode10":
        return this.setSlowmode("10");
      case "slowoff":
      case "slowmodeoff":
      case "slow0":
      case "slowmode0":
        return this.setSlowmode("off");
      case "aislow":
      case "aislowmode":
        return this.setAiSlowmode(parsed.argsText);
      case "purge":
        return this.purgeMessages(parsed.argsText, context);
      case "reportreview":
        return this.reviewReport(parsed.argsText);
      case "summary":
      case "weeklysummary":
      case "chatrecap":
      case "recap":
        return this.generateSummary(context.chatHistory || []);
      default:
        return "Unknown command. Type /help.";
    }
  }

  handleUserCommand(parsed, message, context) {
    switch (parsed.name) {
      case "help":
      case "commands":
        return [
          "User commands: /help, /rules, /report, /admin, /info, /tagbot, /status, /commands",
          "Admin commands: /kick, /ban, /mute, /unmute, /warn, /clearwarns, /setwelcome, /setrules, /setprefix, /lockgroup, /unlockgroup, /slowmode, /summary",
          "Owner note: OWNER can approve admins and change bot configuration.",
          "Example: /report Spam in chat"
        ].join("\n");
      case "rules":
        return this.config.rules || DEFAULTS.rules;
      case "report": {
        const reason = parsed.argsText || "No reason provided.";
        this.log("report", { senderId: message.sender?.id, reason, ok: true });
        return "Report received. An admin will review this.";
      }
      case "admin":
        return DEFAULTS.adminAlert.replace("[reason]", "User requested admin help.");
      case "info":
        return "AeroGroupGuard: group moderation and assistance bot.";
      case "faq":
        return this.faq;
      case "tagbot":
        return parsed.argsText ? "Thanks. An admin or bot handler can review this." : "Please include your question after /tagbot.";
      case "status":
        return `Status: enabled. Welcome: ${this.config.welcomeEnabled ? "on" : "off"}. Lock: ${this.config.locked ? "on" : "off"}.`;
      case "summaryrequest":
        this.log("summaryrequest", { senderId: message.sender?.id, ok: true });
        return "Summary request received. An admin can run /summary.";
      default:
        return "Unknown command. Type /help.";
    }
  }

  handleKeyword(message) {
    const text = normalizeText(message.text);
    const hasBotMention = text.includes(normalizeText(this.botMention));
    const actionable = hasBotMention || containsAny(text, ["call admin", "admin help"]);

    if (!actionable) return null;
    if (text.includes("call admin")) return DEFAULTS.adminAlert.replace("[reason]", "User requested admin attention.");
    if (text.includes("admin help")) return "Describe the issue and use /report if needed.";
    
    if (!hasBotMention) return null;
    
    if (text.includes("report")) return "Please share issue details with /report.";
    if (text.includes("welcome")) return this.config.welcomeMessage;
    if (text.includes("rules")) return this.config.rules;
    if (text.includes("faq")) return this.faq;
    if (text.includes("info")) return "AeroGroupGuard: group assistant bot for help, rules, reports, FAQs, welcomes, and summaries.";
    if (text.includes("mute")) return "Mute is admin-only. Example: /mute @user 10m reason";
    if (text.includes("ban")) return "Ban is admin-only. Example: /ban @user reason";
    if (text.includes("kick")) return "Kick is admin-only. Example: /kick @user reason";
    return "Yes? Type /help for commands.";
  }

  handleMentionIntent(intent, message, context) {
    const commandAliases = {
      help: "help",
      commands: "commands",
      rule: "rules",
      rules: "rules",
      faq: "faq",
      faqs: "faq",
      info: "info",
      status: "status",
      report: "report",
      summary: "summary",
      recap: "recap"
    };
    const name = commandAliases[intent.name] || intent.name;

    if (USER_COMMANDS.has(name) || ADMIN_COMMANDS.has(name)) {
      return this.handleCommand({ name, argsText: intent.argsText }, message, context);
    }

    this.log("mention_assist", { senderId: message.sender?.id, intent: intent.name, ok: true });
    return "I can help with /help, /rules, /faq, /info, /report, and summaries.";
  }

  runPlatformAction(context, action, target, reason, successText) {
    const actionFn = context.platformActions?.[action];
    if (typeof actionFn !== "function") {
      this.log(action, { target, reason, ok: false, fallback: true });
      return `Cannot ${action} ${target} on this platform. Admins should review manually.`;
    }

    try {
      actionFn({ target, reason });
      this.log(action, { target, reason, ok: true });
      return successText;
    } catch (error) {
      this.log(action, { target, reason, ok: false, error: error.message });
      return `Cannot ${action} ${target}: ${error.message}`;
    }
  }

  warnUser(target, reason) {
    const count = (this.warns.get(target) || 0) + 1;
    this.warns.set(target, count);
    this.log("warn", { target, reason, count, ok: true });
    return `${target} has been warned${withReason(reason)}. Total warnings: ${count}.`;
  }

  setWelcome(argsText) {
    const value = argsText.trim().toLowerCase();
    if (!["on", "off"].includes(value)) return "Use /setwelcome on or /setwelcome off.";
    this.config.welcomeEnabled = value === "on";
    this.log("setwelcome", { value, ok: true });
    return `Welcome messages ${value}.`;
  }

  setRules(argsText) {
    const rules = argsText.trim();
    if (!rules) return "Please provide rules text.";
    this.config.rules = rules;
    this.log("setrules", { ok: true });
    return "Rules updated.";
  }

  setPrefix(argsText) {
    const prefix = argsText.trim();
    if (!prefix) return "Please provide a prefix symbol.";
    this.config.prefix = prefix;
    this.log("setprefix", { prefix, ok: true });
    return `Prefix set to ${prefix}.`;
  }

  setGroupLock(argsText) {
    const value = argsText.trim().toLowerCase();
    if (!["on", "off"].includes(value)) return "Use /lockgroup on or /lockgroup off.";
    this.config.locked = value === "on";
    this.log("lockgroup", { value, ok: true });
    return `Group lock ${value}.`;
  }

  setSlowmode(argsText) {
    const val = argsText.trim().toLowerCase();
    if (val === "off" || val === "disable") {
      this.config.slowmodeSeconds = 0;
      this.log("slowmode", { seconds: 0, ok: true });
      return "Slowmode disabled.";
    }
    const seconds = Number.parseInt(val, 10);
    if (!Number.isFinite(seconds) || seconds < 0) return "Please specify slowmode duration in seconds.";
    this.config.slowmodeSeconds = seconds;
    this.log("slowmode", { seconds, ok: true });
    return seconds === 0 ? "Slowmode disabled." : `Slowmode set to ${seconds} seconds.`;
  }

  setAiSlowmode(argsText) {
    const val = argsText.trim().toLowerCase();
    if (val === "off" || val === "disable") {
      this.config.aiSlowmodeSec = 0;
      this.log("aislow", { seconds: 0, ok: true });
      return "AI chatbot slowmode disabled.";
    }
    const seconds = Number.parseInt(val, 10);
    if (!Number.isFinite(seconds) || seconds < 0) return "Please specify AI slowmode duration in seconds.";
    this.config.aiSlowmodeSec = seconds;
    this.log("aislow", { seconds, ok: true });
    return seconds === 0 ? "AI chatbot slowmode disabled." : `AI chatbot slowmode set to ${seconds} seconds.`;
  }

  purgeMessages(argsText, context) {
    const count = Number.parseInt(argsText.trim(), 10);
    if (!Number.isFinite(count) || count < 1 || count > 1000) return "Please specify a purge count from 1 to 1000.";
    return this.runPlatformAction(context, "purge", `${count} messages`, "", `${count} messages purged.`);
  }

  reviewReport(argsText) {
    const reportId = argsText.trim();
    if (!reportId) return "Please specify a report ID.";
    this.log("reportreview", { reportId, ok: true });
    return `Report ${reportId} marked for admin review.`;
  }

  generateSummary(chatHistory) {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recent = chatHistory.filter((entry) => {
      const timestamp = new Date(entry.timestamp || entry.createdAt || 0).getTime();
      return Number.isFinite(timestamp) && timestamp >= sevenDaysAgo && entry.text;
    });

    if (recent.length < 3) {
      this.log("summary", { ok: false, reason: "not_enough_history" });
      return "Not enough chat history available for a 7-day summary.";
    }

    const lines = recent.map((entry) => entry.text);
    const topics = topKeywords(lines, ["the", "and", "for", "you", "are", "with", "this", "that", "please", "admin"]);
    const decisions = lines.filter((line) => /\b(decided|approved|agreed|confirmed|final)\b/i.test(line)).slice(0, 3);
    const issues = lines.filter((line) => /\b(issue|problem|complaint|spam|broken|error|delay)\b/i.test(line)).slice(0, 3);
    const tasks = lines.filter((line) => /\b(todo|task|pending|follow up|need to|will)\b/i.test(line)).slice(0, 3);
    const announcements = lines.filter((line) => /\b(announcement|notice|reminder|event|launch)\b/i.test(line)).slice(0, 3);

    this.log("summary", { ok: true, count: recent.length });
    return [
      "7-day summary:",
      `Main topics: ${topics.length ? topics.join(", ") : "general discussion"}.`,
      `Decisions: ${formatSummaryList(decisions)}`,
      `Issues: ${formatSummaryList(issues)}`,
      `Tasks: ${formatSummaryList(tasks)}`,
      `Announcements: ${formatSummaryList(announcements)}`
    ].join("\n");
  }

  getPermissionLevel(sender, context) {
    if (sender?.id && sender.id === this.ownerId) return PermissionLevel.OWNER;
    if (sender?.permissionLevel && PermissionLevel[sender.permissionLevel]) return sender.permissionLevel;
    if (context.adminIds?.includes(sender?.id) || sender?.isPlatformAdmin) return PermissionLevel.ADMIN;
    return PermissionLevel.USER;
  }

  log(action, payload) {
    this.logs.push({
      action,
      payload,
      at: new Date().toISOString()
    });
  }
}

function extractTarget(argsText) {
  return argsText.trim().match(/^(@\S+|\S+)/)?.[1] || "";
}

function extractDuration(argsText) {
  const parts = argsText.trim().split(/\s+/);
  const raw = parts[1] || "";
  const match = raw.match(/^(\d+)(s|m|h|d)?$/i);
  if (!match) return null;

  const amount = Number.parseInt(match[1], 10);
  const unit = (match[2] || "s").toLowerCase();
  const labels = { s: "seconds", m: "minutes", h: "hours", d: "days" };
  return { amount, unit, label: `${amount} ${labels[unit]}` };
}

function extractReason(argsText, options = {}) {
  const parts = argsText.trim().split(/\s+/).filter(Boolean);
  const skip = options.skipDuration ? 2 : 1;
  return parts.slice(skip).join(" ");
}

function withReason(reason) {
  return reason ? `: ${reason}` : "";
}

function isPrivileged(level) {
  return level === PermissionLevel.OWNER || level === PermissionLevel.ADMIN;
}

function normalizeMention(mention) {
  return mention.startsWith("@") ? mention : `@${mention}`;
}

function normalizeText(text) {
  return String(text || "").toLowerCase();
}

function normalizeIntentName(value) {
  return String(value || "").toLowerCase().replace(/[^\w]/g, "");
}

function containsAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

function mentionFromUser(user) {
  if (user?.username) return `@${user.username}`;
  if (user?.name) return `@${String(user.name).replace(/\s+/g, "")}`;
  return "@user";
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function topKeywords(lines, stopWords) {
  const stop = new Set(stopWords);
  const counts = new Map();
  for (const line of lines) {
    const words = line.toLowerCase().match(/\b[a-z][a-z0-9]{3,}\b/g) || [];
    for (const word of words) {
      if (stop.has(word)) continue;
      counts.set(word, (counts.get(word) || 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([word]) => word);
}

function formatSummaryList(items) {
  return items.length ? items.join(" | ") : "none noted.";
}

module.exports = {
  AeroGroupGuard,
  PermissionLevel,
  DEFAULTS
};
