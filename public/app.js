// Application state - this MUST be declared before any code that references it
const state = {
  role: "OWNER",
  dashboard: { metrics: {}, groups: [], recentReports: [], notifications: [], activityFeed: [], systemHealth: {} },
  commands: {},
  portal: { installation: [], ownerPortal: { capabilities: [] }, adminPortal: { capabilities: [] }, userPortal: { capabilities: [] }, admins: [] },
  manual: { templates: [], customCommands: [], automations: [], scheduledMessages: [], quickActions: [], liveControls: [] },
  assistant: { assistantMode: { enabled: false, botMention: '', nonDestructiveOnly: false, autoWelcome: false, allowedReplies: [], blockedActions: [] }, outboundMessages: [] },
  audit: [],
  connection: { connected: false, method: null, identifier: null, logs: [] }
};

// Connection tabs state
let activeTab = "api";
let currentUserbotPhoneOrEmail = "";

document.addEventListener("DOMContentLoaded", () => {
  const tabs = [
    { btn: "tabApiBtn", panel: "panelApi", key: "api" },
    { btn: "tabCookieBtn", panel: "panelCookie", key: "cookie" },
    { btn: "tabUserbotBtn", panel: "panelUserbot", key: "userbot" }
  ];

  tabs.forEach(tab => {
    const btn = document.getElementById(tab.btn);
    if (btn) {
      btn.addEventListener("click", () => {
        tabs.forEach(t => {
          document.getElementById(t.btn).classList.remove("active");
          document.getElementById(t.panel).classList.remove("active");
        });
        btn.classList.add("active");
        document.getElementById(tab.panel).classList.add("active");
        activeTab = tab.key;
      });
    }
  });

  // Cookie Injection Connection
  const connectCookieBtn = document.getElementById("connectCookieBtn");
  if (connectCookieBtn) {
    connectCookieBtn.addEventListener("click", async () => {
      const cookieVal = document.getElementById("cookieInput").value.trim();
      if (!cookieVal) {
        showToast("Please paste browser cookies before connecting!", "error");
        return;
      }
      
      setLoading(connectCookieBtn, true);
      printTerminal("Initiating browser session cookie injection bypass...");
      try {
        const result = await post("/api/install/cookie", { cookie: cookieVal });
        if (result.error) {
          printTerminal(`Error: ${result.error}`, "danger");
          showToast("Cookie injection failed: " + result.error, "error");
        } else {
          showToast("Cookie injected! Bot connected successfully!", "success");
          await refresh();
        }
      } catch(e) { showToast("Connection failed: " + e.message, "error"); }
      setLoading(connectCookieBtn, false);
    });
  }

  // Aero Login Handler
  const requestOtpBtn = document.getElementById("requestOtpBtn");
  if (requestOtpBtn) {
    requestOtpBtn.addEventListener("click", async () => {
      const email = document.getElementById("userbotIdentifier").value.trim();
      const password = document.getElementById("userbotPassword").value.trim();
      if (!email || !password) {
        showToast("Please enter both email and password.", "error");
        return;
      }
      
      setLoading(requestOtpBtn, true);
      printTerminal(`Initiating direct login sequence for ${email}...`);
      try {
        const result = await post("/api/install/login", { email, password });
        if (result.error) {
          printTerminal(`Error: ${result.error}`, "danger");
          showToast("Login failed: " + result.error, "error");
        } else {
          if (result.logs) {
            result.logs.forEach(l => printTerminal(l));
          }
          showToast("Connected to Aero Messenger successfully!", "success");
          await refresh();
        }
      } catch (e) {
        printTerminal(`Error: ${e.message}`, "danger");
        showToast("Connection failed: " + e.message, "error");
      }
      setLoading(requestOtpBtn, false);
    });
  }

  // Disconnect Bot
  const disconnectBotBtn = document.getElementById("disconnectBotBtn");
  if (disconnectBotBtn) {
    disconnectBotBtn.addEventListener("click", async () => {
      setLoading(disconnectBotBtn, true);
      printTerminal("Disconnecting active account...");
      try {
        const result = await post("/api/install/disconnect", {});
        if (result.success) {
          showToast("Bot disconnected successfully.", "info");
          await refresh();
        }
      } catch(e) { showToast("Disconnect failed: " + e.message, "error"); }
      setLoading(disconnectBotBtn, false);
    });
  }

  // Manual kick button
  const manualKickBtn = document.getElementById("manualKickBtn");
  if (manualKickBtn) {
    manualKickBtn.addEventListener("click", async () => {
      const targetUserId = document.getElementById("moderationUserId").value.trim();
      if (!targetUserId) {
        showToast("Please enter a Target User ID", "error");
        return;
      }
      setLoading(manualKickBtn, true);
      try {
        const result = await post("/api/manual/groups/action", {
          actor: actor(),
          action: "kick_user",
          groupIds: selectedGroups(),
          targetUserId
        });
        if (result.error) {
          showToast("Error: " + result.error, "error");
        } else {
          showToast("Kick request processed!", "success");
          document.getElementById("moderationUserId").value = "";
        }
      } catch (e) {
        showToast("Kick action failed: " + e.message, "error");
      }
      setLoading(manualKickBtn, false);
      await refresh();
    });
  }

  // Manual ban button
  const manualBanBtn = document.getElementById("manualBanBtn");
  if (manualBanBtn) {
    manualBanBtn.addEventListener("click", async () => {
      const targetUserId = document.getElementById("moderationUserId").value.trim();
      if (!targetUserId) {
        showToast("Please enter a Target User ID", "error");
        return;
      }
      setLoading(manualBanBtn, true);
      try {
        const result = await post("/api/manual/groups/action", {
          actor: actor(),
          action: "ban_user",
          groupIds: selectedGroups(),
          targetUserId
        });
        if (result.error) {
          showToast("Error: " + result.error, "error");
        } else {
          showToast("Ban request processed!", "success");
          document.getElementById("moderationUserId").value = "";
        }
      } catch (e) {
        showToast("Ban action failed: " + e.message, "error");
      }
      setLoading(manualBanBtn, false);
      await refresh();
    });
  }
});

function printTerminal(message, type = "") {
  const term = document.getElementById("connectionTerminal");
  if (term.textContent === "Scraper engine is idle. Select a method to initiate bot installation...") {
    term.innerHTML = "";
  }
  const className = type ? ` class="term-line-${type}"` : "";
  term.insertAdjacentHTML("beforeend", `<div${className}>[${new Date().toLocaleTimeString()}] ${escapeHtml(message)}</div>`);
  term.scrollTop = term.scrollHeight;
}

// Toast notification system
function showToast(message, type = "success") {
  let container = document.getElementById("toastContainer");
  if (!container) {
    container = document.createElement("div");
    container.id = "toastContainer";
    container.style.cssText = "position:fixed;top:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:10px;";
    document.body.appendChild(container);
  }
  const toast = document.createElement("div");
  const bgColor = type === "success" ? "#10b981" : type === "error" ? "#ef4444" : type === "info" ? "#3b82f6" : "#f59e0b";
  toast.style.cssText = `background:${bgColor};color:#fff;padding:12px 20px;border-radius:10px;font-size:14px;font-weight:600;box-shadow:0 8px 30px rgba(0,0,0,0.25);min-width:280px;max-width:420px;opacity:0;transform:translateX(40px);transition:all 0.3s ease;font-family:Inter,sans-serif;`;
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => { toast.style.opacity = "1"; toast.style.transform = "translateX(0)"; });
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(40px)";
    setTimeout(() => toast.remove(), 350);
  }, 3500);
}

// Button loading state helper
function setLoading(btn, loading) {
  if (!btn) return;
  btn.disabled = loading;
  if (loading) {
    btn.dataset.originalText = btn.textContent;
    btn.textContent = "Processing...";
    btn.style.opacity = "0.7";
  } else {
    btn.textContent = btn.dataset.originalText || btn.textContent;
    btn.style.opacity = "1";
  }
}

document.getElementById("themeToggle").addEventListener("click", () => {
  document.body.classList.toggle("dark");
});

document.getElementById("roleSelect").addEventListener("change", (event) => {
  state.role = event.target.value;
  renderRoleState();
});

document.getElementById("exportCsv").addEventListener("click", () => {
  window.location.href = "/api/reports/export";
});

document.getElementById("exportExcel").addEventListener("click", () => {
  const rows = [["Metric", "Value"], ["Daily active users", text("dailyActiveUsers")], ["Connected groups", text("connectedGroups")]];
  download("aero-dashboard.xls", rows.map((row) => row.join("\t")).join("\n"), "application/vnd.ms-excel");
});

document.getElementById("previewMessage").addEventListener("click", async () => {
  const btn = document.getElementById("previewMessage");
  const msg = document.getElementById("manualMessage").value.trim();
  if (!msg) { showToast("Please type a message first!", "error"); return; }
  setLoading(btn, true);
  try {
    const result = await post("/api/manual/messages/preview", manualMessagePayload());
    document.getElementById("messagePreview").textContent = JSON.stringify(result.preview, null, 2);
    showToast("Message preview generated!", "info");
  } catch(e) { showToast("Preview failed: " + e.message, "error"); }
  setLoading(btn, false);
});

document.getElementById("sendMessage").addEventListener("click", async () => {
  const btn = document.getElementById("sendMessage");
  const msg = document.getElementById("manualMessage").value.trim();
  if (!msg) { showToast("Please type a message to send!", "error"); return; }
  setLoading(btn, true);
  try {
    const result = await post("/api/manual/messages/send", { ...manualMessagePayload(), actor: actor() });
    if (result.error) { showToast("Error: " + result.error, "error"); }
    else {
      document.getElementById("messagePreview").textContent = JSON.stringify(result, null, 2);
      showToast(`Message sent to ${result.result?.sent || 0} group(s)!`, "success");
      document.getElementById("manualMessage").value = "";
    }
    await refresh();
  } catch(e) { showToast("Send failed: " + e.message, "error"); }
  setLoading(btn, false);
});

document.getElementById("scheduleMessage").addEventListener("click", async () => {
  const btn = document.getElementById("scheduleMessage");
  const msg = document.getElementById("manualMessage").value.trim();
  if (!msg) { showToast("Please type a message to schedule!", "error"); return; }
  setLoading(btn, true);
  try {
    const runAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const result = await post("/api/manual/messages/schedule", { ...manualMessagePayload(), actor: actor(), runAt });
    if (result.error) { showToast("Error: " + result.error, "error"); }
    else {
      document.getElementById("messagePreview").textContent = JSON.stringify(result, null, 2);
      showToast(`Message scheduled for ${new Date(runAt).toLocaleTimeString()}!`, "success");
      document.getElementById("manualMessage").value = "";
    }
    await refresh();
  } catch(e) { showToast("Schedule failed: " + e.message, "error"); }
  setLoading(btn, false);
});

document.getElementById("runConsole").addEventListener("click", async () => {
  const btn = document.getElementById("runConsole");
  const instruction = document.getElementById("consoleInstruction").value.trim();
  if (!instruction) { showToast("Type an instruction first!", "error"); return; }
  addConsole("You", instruction);
  setLoading(btn, true);
  try {
    const result = await post("/api/manual/console", { instruction, actor: actor(), groupIds: selectedGroups() });
    if (result.error) { addConsole("Bot", "Error: " + result.error); showToast("Console error: " + result.error, "error"); }
    else {
      addConsole("Bot", typeof result.output === "string" ? result.output : JSON.stringify(result.output, null, 2));
      showToast("AI Console executed!", "success");
    }
    document.getElementById("consoleInstruction").value = "";
    await refresh();
  } catch(e) { showToast("Console failed: " + e.message, "error"); }
  setLoading(btn, false);
});

document.getElementById("saveAutomation").addEventListener("click", async () => {
  const btn = document.getElementById("saveAutomation");
  const trigger = value("autoTrigger"), condition = value("autoCondition"), action = value("autoAction");
  if (!trigger || !action) { showToast("Fill in trigger and action!", "error"); return; }
  setLoading(btn, true);
  try {
    const result = await post("/api/automations", { actor: actor(), trigger, condition, action });
    if (result.error) { showToast("Error: " + result.error, "error"); }
    else { showToast("Automation saved successfully!", "success"); }
    await refresh();
  } catch(e) { showToast("Save failed: " + e.message, "error"); }
  setLoading(btn, false);
});

document.getElementById("saveCommand").addEventListener("click", async () => {
  const btn = document.getElementById("saveCommand");
  const name = value("commandName"), response = value("commandResponse");
  if (!name || !response) { showToast("Fill in command name and response!", "error"); return; }
  setLoading(btn, true);
  try {
    const result = await post("/api/custom-commands", { actor: actor(), name, response, languages: ["en", "hi"], attachments: [] });
    if (result.error) { showToast("Error: " + result.error, "error"); }
    else { showToast(`Command ${name} saved!`, "success"); }
    await refresh();
  } catch(e) { showToast("Save failed: " + e.message, "error"); }
  setLoading(btn, false);
});

async function refresh() {
  try {
    const [dashboard, commands, portal, manual, assistant, audit, connStatus, approvals] = await Promise.all([
      fetch("/api/dashboard").then((res) => res.json()),
      fetch("/api/commands").then((res) => res.json()),
      fetch("/api/portal").then((res) => res.json()),
      fetch("/api/manual-control").then((res) => res.json()),
      fetch("/api/assistant-mode").then((res) => res.json()),
      fetch("/api/audit-logs").then((res) => res.json()),
      fetch("/api/install/status").then((res) => res.json()),
      fetch("/api/user-approvals").then((res) => res.json())
    ]);
    state.dashboard = dashboard;
    state.commands = commands;
    state.portal = portal;
    state.manual = manual;
    state.assistant = assistant;
    state.audit = audit.auditLogs;
    state.connection = connStatus;
    state.approvals = approvals;
    render();
  } catch (err) {
    console.error("Dashboard refresh failed:", err);
  }
}

function render() {
  const metrics = state.dashboard.metrics || {};
  setText("dailyActiveUsers", metrics.dailyActiveUsers || 0);
  setText("weeklyActiveUsers", metrics.weeklyActiveUsers || 0);
  setText("messageVolume", metrics.messageVolume || 0);
  setText("aiUsage", metrics.aiUsage?.requests7d || 0);
  setText("connectedGroups", state.dashboard.groups.length);
  setText("openReports", state.dashboard.recentReports.filter((report) => report.status !== "resolved").length);

  // Update status badge UI
  const badgeEl = document.getElementById("botStatusBadge");
  const indicatorEl = badgeEl ? badgeEl.querySelector(".status-indicator") : null;
  const textEl = document.getElementById("statusBadgeText");
  const discBtn = document.getElementById("disconnectBotBtn");

  if (badgeEl && indicatorEl && textEl && discBtn) {
    if (state.connection && state.connection.connected) {
      badgeEl.className = "connection-status-badge online";
      indicatorEl.className = "status-indicator online";
      textEl.textContent = `Connected (${state.connection.method === "cookie" ? "Cookie" : "Userbot"})`;
      discBtn.classList.remove("hidden");
      
      // Fill terminal logs
      if (state.connection.logs && state.connection.logs.length) {
        const term = document.getElementById("connectionTerminal");
        if (term) {
          term.innerHTML = state.connection.logs.map(line => `<div>${escapeHtml(line)}</div>`).join("");
        }
      }
    } else {
      badgeEl.className = "connection-status-badge offline";
      indicatorEl.className = "status-indicator offline";
      textEl.textContent = "Not Connected";
      discBtn.classList.add("hidden");
    }
  }

  document.getElementById("installSteps").innerHTML = state.portal.installation.map((step) => `<li>${escapeHtml(step)}</li>`).join("");
  document.getElementById("ownerCapabilities").innerHTML = state.portal.ownerPortal.capabilities.map((item) => `<span>${labelize(item)}</span>`).join("");

  document.getElementById("adminRows").innerHTML = state.portal.admins.map((admin) => `
    <tr><td>${escapeHtml(admin.name)}</td><td>${admin.groups.length}</td><td>${admin.permissions.map(labelize).join(", ")}</td></tr>
  `).join("");

  document.getElementById("assistantModeChips").innerHTML = [
    `Enabled: ${state.assistant.assistantMode.enabled ? "yes" : "no"}`,
    `Mention: ${state.assistant.assistantMode.botMention}`,
    `Auto welcome: ${state.assistant.assistantMode.autoWelcome ? "on" : "off"}`,
    `Assistant only: ${state.assistant.assistantMode.nonDestructiveOnly ? "on" : "off"}`
  ].map((item) => `<span>${escapeHtml(item)}</span>`).join("");
  document.getElementById("allowedReplies").innerHTML = state.assistant.assistantMode.allowedReplies.map((item) => `<span>${labelize(item)}</span>`).join("");
  document.getElementById("blockedActions").innerHTML = state.assistant.assistantMode.blockedActions.map((item) => `<span>${labelize(item)}</span>`).join("");
  document.getElementById("outboundMessages").innerHTML = state.assistant.outboundMessages.length
    ? state.assistant.outboundMessages.map((item) => `<li>${escapeHtml(item.reason)} - ${escapeHtml(item.text)}</li>`).join("")
    : "<li>No auto replies queued yet.</li>";

  const selectEl = document.getElementById("messageGroups");
  let previousSelections = [];
  let hasPrevious = selectEl && selectEl.options.length > 0;
  if (hasPrevious) {
    previousSelections = Array.from(selectEl.selectedOptions).map((option) => option.value);
  }
  const groupOptions = state.dashboard.groups.map((group, idx) => {
    const isSelected = hasPrevious ? previousSelections.includes(group.id) : (idx === 0);
    return `<option value="${group.id}"${isSelected ? " selected" : ""}>${escapeHtml(group.name)}</option>`;
  }).join("");
  selectEl.innerHTML = groupOptions;

  document.getElementById("liveControls").innerHTML = state.manual.liveControls.map((name) => (
    `<button type="button" data-live-action="${slug(name)}">${escapeHtml(name)}</button>`
  )).join("");
  document.getElementById("quickActions").innerHTML = state.manual.quickActions.map((name) => (
    `<button type="button" data-quick-action="${slug(name)}">${escapeHtml(name)}</button>`
  )).join("");

  document.querySelectorAll("[data-live-action]").forEach((button) => {
    button.onclick = () => runGroupAction(button.dataset.liveAction);
  });
  document.querySelectorAll("[data-quick-action]").forEach((button) => {
    button.onclick = () => addConsole("Quick Action", button.textContent);
  });

  document.getElementById("automationList").innerHTML = state.manual.automations.map((item) => (
    `<li>IF ${escapeHtml(item.trigger)} WHEN ${escapeHtml(item.condition)} THEN ${escapeHtml(item.action)}</li>`
  )).join("");
  document.getElementById("commandList").innerHTML = state.manual.customCommands.map((item) => (
    `<li>${escapeHtml(item.name)} - ${escapeHtml(item.response)}</li>`
  )).join("");
  document.getElementById("reportList").innerHTML = state.dashboard.recentReports.map((report) => (
    `<li>${escapeHtml(report.id)} - ${escapeHtml(report.status)} - ${escapeHtml(report.text)}</li>`
  )).join("") || "<li>No reports.</li>";
  document.getElementById("groupRows").innerHTML = state.dashboard.groups.map((group) => `
    <tr><td>${escapeHtml(group.name)}</td><td>${group.members}</td><td>${group.language}</td><td>${group.botEnabled ? "enabled" : "disabled"}</td></tr>
  `).join("");
  document.getElementById("activityFeed").innerHTML = state.dashboard.activityFeed.map((item) => `<li>${escapeHtml(item.text)}</li>`).join("");
  document.getElementById("notifications").innerHTML = state.dashboard.notifications.map((item) => `<li>${escapeHtml(item.level)}: ${escapeHtml(item.text)}</li>`).join("");
  document.getElementById("auditList").innerHTML = state.audit.length
    ? state.audit.map((item) => `<li>${escapeHtml(item.actorRole)} ${escapeHtml(item.action)} at ${escapeHtml(item.at)}</li>`).join("")
    : "<li>No manual actions yet.</li>";

  document.getElementById("analyticsText").textContent = JSON.stringify({
    topGroups: metrics.topGroups,
    topAdmins: metrics.topAdmins,
    mostUsedCommands: metrics.mostUsedCommands,
    languageDistribution: metrics.languageDistribution,
    aiUsage: metrics.aiUsage
  }, null, 2);

  document.getElementById("growthBar").style.width = `${Math.min(100, (metrics.growthMetrics?.newMembers7d || 1) * 20)}%`;
  document.getElementById("engagementBar").style.width = `${Math.min(100, (metrics.engagementMetrics?.totalEvents || 1) * 12)}%`;
  document.getElementById("aiBar").style.width = `${Math.min(100, (metrics.aiUsage?.requests7d || 1))}%`;

  // Render pending approvals
  const pendingListEl = document.getElementById("pendingApprovalsList");
  if (pendingListEl) {
    if (state.approvals && state.approvals.pendingUsers && state.approvals.pendingUsers.length > 0) {
      pendingListEl.innerHTML = state.approvals.pendingUsers.map(user => `
        <li class="approval-item" style="display:flex; justify-content:space-between; align-items:center; padding:8px; border-bottom:1px solid var(--line);">
          <div>
            <strong style="color:var(--text);">${escapeHtml(user.displayName)}</strong> 
            <small style="color:var(--muted);">(@${escapeHtml(user.username)} - ID: ${escapeHtml(user.id)})</small>
          </div>
          <div class="actions" style="display:flex; gap:6px;">
            <button class="approve-btn" onclick="handleApproveUser('${user.id}')" style="min-height:28px; padding:4px 8px; font-size:12px; background:var(--ok); border-color:var(--ok); color:#fff; font-weight:650;">Approve</button>
            <button class="reject-btn" onclick="handleRejectUser('${user.id}')" style="min-height:28px; padding:4px 8px; font-size:12px; background:var(--danger); border-color:var(--danger); color:#fff; font-weight:650;">Reject</button>
          </div>
        </li>
      `).join("");
    } else {
      pendingListEl.innerHTML = "<li>No pending approvals.</li>";
    }
  }

  // Render approved users
  const approvedListEl = document.getElementById("approvedUsersList");
  if (approvedListEl) {
    if (state.approvals && state.approvals.approvedUsers && state.approvals.approvedUsers.length > 0) {
      approvedListEl.innerHTML = state.approvals.approvedUsers.map(userId => `
        <span class="whitelist-chip" style="display:inline-flex; align-items:center; background:var(--panel-soft); border:1px solid var(--line); color:var(--text); padding:4px 8px; border-radius:6px; font-size:13px; margin:4px;">
          ${escapeHtml(userId)}
        </span>
      `).join("");
    } else {
      approvedListEl.innerHTML = "<span>No whitelisted users yet.</span>";
    }
  }

  renderRoleState();
}

function renderRoleState() {
  const isUser = state.role === "USER";
  document.querySelectorAll("#manual button, #automations button, #commands button").forEach((button) => {
    button.disabled = isUser;
    button.title = isUser ? "Dashboard control access is not available to users." : "";
  });
}

async function runGroupAction(action) {
  const actionMap = {
    send_message: "send_message",
    mention_everyone: "mention_everyone",
    lock_group: "lock",
    unlock_group: "unlock",
    enable_slow_mode: "slowmode_on",
    disable_slow_mode: "slowmode_off",
    generate_summary: "summary",
    export_chat_data: "export_chat",
    review_reports: "review_reports",
    view_logs: "view_logs"
  };
  const result = await post("/api/manual/groups/action", {
    actor: actor(),
    action: actionMap[action] || action,
    groupIds: selectedGroups()
  });
  if (result.error) {
    addConsole("Live Control", "Error: " + result.error);
  } else {
    addConsole("Live Control", result.output || JSON.stringify(result, null, 2));
  }
  await refresh();
}

function manualMessagePayload() {
  return {
    groupIds: selectedGroups(),
    message: value("manualMessage")
  };
}

function selectedGroups() {
  return Array.from(document.getElementById("messageGroups").selectedOptions).map((option) => option.value);
}

async function post(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  return res.json();
}

function addConsole(author, message) {
  const history = document.getElementById("consoleHistory");
  history.insertAdjacentHTML("beforeend", `<div class="chat-bubble"><strong>${escapeHtml(author)}</strong><br>${escapeHtml(message)}</div>`);
  history.scrollTop = history.scrollHeight;
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function actor() {
  return { id: "owner-1", role: state.role || "OWNER" };
}

function value(id) {
  return document.getElementById(id).value.trim();
}

function text(id) {
  return document.getElementById(id).textContent;
}

function setText(id, value) {
  document.getElementById(id).textContent = value;
}

function labelize(value) {
  return escapeHtml(String(value || "").replace(/_/g, " "));
}

function slug(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  })[char]);
}

refresh();
setInterval(refresh, 10000);

window.handleApproveUser = async function(userId) {
  try {
    const res = await post("/api/user-approvals/approve", { userId });
    if (res.success) {
      showToast("User approved successfully!", "success");
      await refresh();
    } else {
      showToast("Failed to approve user: " + (res.error || "unknown"), "error");
    }
  } catch (e) {
    showToast("Approval error: " + e.message, "error");
  }
};

window.handleRejectUser = async function(userId) {
  try {
    const res = await post("/api/user-approvals/reject", { userId });
    if (res.success) {
      showToast("User approval request rejected.", "info");
      await refresh();
    } else {
      showToast("Failed to reject user: " + (res.error || "unknown"), "error");
    }
  } catch (e) {
    showToast("Rejection error: " + e.message, "error");
  }
};
