// Wrap window.fetch to support routing all requests to the configured backend and injecting authorization headers
(() => {
  const originalFetch = window.fetch;
  window.fetch = function (input, init) {
    const backendUrl = localStorage.getItem("aero_backend_url");
    if (typeof input === "string" && input.startsWith("/api/")) {
      if (backendUrl) {
        const baseUrl = backendUrl.replace(/\/$/, "");
        input = baseUrl + input;
      }
    }
    const token = localStorage.getItem("aero_admin_token");
    if (token) {
      if (!init) init = {};
      if (!init.headers) init.headers = {};
      if (init.headers instanceof Headers) {
        if (!init.headers.has("X-Admin-Token")) {
          init.headers.set("X-Admin-Token", token);
        }
      } else {
        if (!init.headers["X-Admin-Token"] && !init.headers["x-admin-token"]) {
          init.headers["X-Admin-Token"] = token;
        }
      }
    }
    return originalFetch(input, init);
  };
})();

// Application state - this MUST be declared before any code that references it
const state = {
  role: "OWNER",
  dashboard: { metrics: {}, groups: [], recentReports: [], notifications: [], activityFeed: [], systemHealth: {} },
  commands: {},
  portal: { installation: [], ownerPortal: { capabilities: [] }, adminPortal: { capabilities: [] }, userPortal: { capabilities: [] }, admins: [] },
  manual: { templates: [], customCommands: [], automations: [], scheduledMessages: [], quickActions: [], liveControls: [] },
  assistant: { assistantMode: { enabled: false, botMention: '', nonDestructiveOnly: false, autoWelcome: false, allowedReplies: [], blockedActions: [] }, outboundMessages: [] },
  audit: [],
  connection: { connected: false, method: null, identifier: null, logs: [] },
  controlCentre: { groups: [], memories: [], keys: {}, keysCheckedAt: null, tokenUsage: {} }
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

  // Control Centre sub-tabs
  const ccTabs = [
    { btn: "tabRoutingBtn", panel: "panelRouting" },
    { btn: "tabMemoryBtn", panel: "panelMemory" },
    { btn: "tabKeysBtn", panel: "panelKeys" },
    { btn: "tabDockControlBtn", panel: "panelDockControl" }
  ];

  ccTabs.forEach(tab => {
    const btn = document.getElementById(tab.btn);
    if (btn) {
      btn.addEventListener("click", () => {
        ccTabs.forEach(t => {
          document.getElementById(t.btn).classList.remove("active");
          document.getElementById(t.panel).classList.remove("active");
        });
        btn.classList.add("active");
        document.getElementById(tab.panel).classList.add("active");
      });
    }
  });

  // Verify Keys Now trigger
  const verifyKeysBtn = document.getElementById("verifyKeysBtn");
  if (verifyKeysBtn) {
    verifyKeysBtn.addEventListener("click", async () => {
      setLoading(verifyKeysBtn, true);
      const grid = document.getElementById("keysGridContainer");
      if (grid) grid.classList.add("keys-grid-loading");
      showToast("Starting live keys health verification...", "info");
      try {
        const result = await post("/api/control-centre/keys/verify", { force: true });
        if (result.error) {
          showToast("Keys verification failed: " + result.error, "error");
        } else {
          state.controlCentre.keys = result.keys;
          state.controlCentre.keysCheckedAt = result.timestamp;
          renderControlCentreKeys();
          showToast("Live keys verification complete!", "success");
        }
      } catch (e) {
        showToast("Verification failed: " + e.message, "error");
      }
      if (grid) grid.classList.remove("keys-grid-loading");
      setLoading(verifyKeysBtn, false);
    });
  }

  // Memory Database search filter
  const memorySearch = document.getElementById("memorySearch");
  if (memorySearch) {
    memorySearch.addEventListener("input", () => {
      renderControlCentreMemory(memorySearch.value.trim());
    });
  }

  // =============================================
  // SECURE BACKEND CONNECTION & SESSION MANAGEMENT
  // =============================================
  let refreshInterval = null;

  async function checkSession() {
    const backendUrl = localStorage.getItem("aero_backend_url");
    const adminToken = localStorage.getItem("aero_admin_token");

    const overlay = document.getElementById("loginOverlay");
    const disconnectBtn = document.getElementById("disconnectBackendBtn");

    if (!backendUrl || !adminToken) {
      const urlInput = document.getElementById("loginBackendUrl");
      if (urlInput && !urlInput.value) {
        urlInput.value = window.location.origin.includes("file://") || window.location.origin.includes("github.io") ? "https://aero-bot-aero-bot.hf.space" : window.location.origin;
      }
      overlay.style.display = "flex";
      if (disconnectBtn) disconnectBtn.style.display = "none";
      return;
    }

    try {
      const res = await fetch("/api/dashboard", {
        headers: { "X-Admin-Token": adminToken }
      });
      if (res.status === 401) {
        throw new Error("Invalid admin password / token");
      }
      if (!res.ok) {
        throw new Error(`Server returned status ${res.status}`);
      }

      overlay.style.display = "none";
      if (disconnectBtn) disconnectBtn.style.display = "inline-block";

      refresh();
      if (refreshInterval) clearInterval(refreshInterval);
      refreshInterval = setInterval(refresh, 10000);

    } catch (err) {
      console.warn("Connection test failed:", err.message);
      overlay.style.display = "flex";
      if (disconnectBtn) disconnectBtn.style.display = "none";

      const errEl = document.getElementById("loginError");
      if (errEl) {
        errEl.textContent = `Connection failed: ${err.message}. Please verify the URL and password.`;
        errEl.style.display = "block";
      }
    }
  }

  async function handleConnect() {
    const urlInput = document.getElementById("loginBackendUrl");
    const passInput = document.getElementById("loginPassword");
    const connectBtn = document.getElementById("loginConnectBtn");
    const errEl = document.getElementById("loginError");

    let url = urlInput.value.trim();
    const password = passInput.value.trim();

    if (!url) {
      showToast("Please enter backend server URL!", "error");
      return;
    }
    if (!password) {
      showToast("Please enter admin password!", "error");
      return;
    }

    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = "https://" + url;
      urlInput.value = url;
    }

    setLoading(connectBtn, true);
    if (errEl) errEl.style.display = "none";

    try {
      const testUrl = url.replace(/\/$/, "") + "/api/dashboard";
      const res = await fetch(testUrl, {
        headers: { "X-Admin-Token": password }
      });

      if (res.status === 401) {
        throw new Error("Invalid Password / Unauthorized.");
      }
      if (!res.ok) {
        throw new Error(`Server returned status ${res.status}`);
      }

      localStorage.setItem("aero_backend_url", url);
      localStorage.setItem("aero_admin_token", password);

      showToast("Connected to server successfully!", "success");
      passInput.value = "";

      await checkSession();
    } catch (err) {
      if (errEl) {
        errEl.textContent = `Connection failed: ${err.message}`;
        errEl.style.display = "block";
      }
      showToast(err.message, "error");
    } finally {
      setLoading(connectBtn, false);
    }
  }

  function handleDisconnect() {
    localStorage.removeItem("aero_backend_url");
    localStorage.removeItem("aero_admin_token");
    if (refreshInterval) clearInterval(refreshInterval);

    showToast("Disconnected from server.", "info");
    checkSession();
  }

  const loginConnectBtn = document.getElementById("loginConnectBtn");
  if (loginConnectBtn) {
    loginConnectBtn.addEventListener("click", handleConnect);
  }

  const loginPassword = document.getElementById("loginPassword");
  if (loginPassword) {
    loginPassword.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        handleConnect();
      }
    });
  }

  const disconnectBtn = document.getElementById("disconnectBackendBtn");
  if (disconnectBtn) {
    disconnectBtn.addEventListener("click", handleDisconnect);
  }

  checkSession();
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

document.getElementById("targetMode").addEventListener("change", (e) => {
  const isAll = e.target.value === "all";
  document.getElementById("messageGroups").disabled = isAll;
  const label = document.getElementById("messageGroupsLabel");
  if (isAll) {
    label.style.opacity = "0.5";
    label.style.pointerEvents = "none";
  } else {
    label.style.opacity = "1";
    label.style.pointerEvents = "auto";
  }
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
    const token = getAdminToken();
    const headers = { "X-Admin-Token": token };
    const [dashboard, commands, portal, manual, assistant, audit, connStatus, approvals, sysMetrics, ccGroups, ccMemory, ccKeys, ccTokenUsage] = await Promise.all([
      fetch("/api/dashboard", { headers }).then((res) => res.json()),
      fetch("/api/commands", { headers }).then((res) => res.json()),
      fetch("/api/portal", { headers }).then((res) => res.json()),
      fetch("/api/manual-control", { headers }).then((res) => res.json()),
      fetch("/api/assistant-mode", { headers }).then((res) => res.json()),
      fetch("/api/audit-logs", { headers }).then((res) => res.json()),
      fetch("/api/install/status", { headers }).then((res) => res.json()),
      fetch("/api/user-approvals", { headers }).then((res) => res.json()),
      fetch("/api/system/metrics", { headers }).then((res) => res.json()).catch(() => ({})),
      fetch("/api/control-centre/groups", { headers }).then((res) => res.json()).catch(() => ({ groups: [] })),
      fetch("/api/control-centre/memory", { headers }).then((res) => res.json()).catch(() => ({ memories: [] })),
      post("/api/control-centre/keys/verify", { force: false }).catch(() => ({})),
      fetch("/api/control-centre/token-usage", { headers }).then((res) => res.json()).catch(() => ({ tokenUsage: {} }))
    ]);
    state.dashboard = dashboard;
    state.commands = commands;
    state.portal = portal;
    state.manual = manual;
    state.assistant = assistant;
    state.audit = audit.auditLogs;
    state.connection = connStatus;
    state.approvals = approvals;
    state.systemMetrics = sysMetrics;
    state.controlCentre.groups = ccGroups.groups || [];
    state.controlCentre.memories = ccMemory.memories || [];
    if (ccKeys && ccKeys.keys) {
      state.controlCentre.keys = ccKeys.keys;
      state.controlCentre.keysCheckedAt = ccKeys.timestamp;
    }
    state.controlCentre.tokenUsage = ccTokenUsage.tokenUsage || {};
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

  // Render system metrics
  if (state.systemMetrics && state.systemMetrics.cpuUsage) {
    const sys = state.systemMetrics;
    
    let cpuPercent = "0.0%";
    if (state._prevMetrics) {
      const timeDiffMs = sys.timestamp - state._prevMetrics.timestamp;
      const cpuDiffUs = (sys.cpuUsage.user + sys.cpuUsage.system) - (state._prevMetrics.cpuUsage.user + state._prevMetrics.cpuUsage.system);
      if (timeDiffMs > 0) {
        const cores = navigator.hardwareConcurrency || 2;
        const rawPercent = (cpuDiffUs / 1000) / timeDiffMs / cores * 100;
        cpuPercent = `${Math.min(100, Math.max(0, rawPercent)).toFixed(1)}%`;
      }
    }
    state._prevMetrics = sys;

    const heapUsedMb = Math.round(sys.memoryUsage.heapUsed / 1024 / 1024);
    const heapTotalMb = Math.round(sys.memoryUsage.heapTotal / 1024 / 1024);
    const rssMb = Math.round(sys.memoryUsage.rss / 1024 / 1024);
    const freeGb = (sys.system.freeMem / 1024 / 1024 / 1024).toFixed(2);
    const totalGb = (sys.system.totalMem / 1024 / 1024 / 1024).toFixed(2);
    const uptimeHrs = (sys.system.uptime / 3600).toFixed(2);

    const sysCpuEl = document.getElementById("sysCpu");
    const sysRamEl = document.getElementById("sysRam");
    const sysTotalMemEl = document.getElementById("sysTotalMem");
    const sysUptimeEl = document.getElementById("sysUptime");

    if (sysCpuEl) sysCpuEl.textContent = cpuPercent;
    if (sysRamEl) sysRamEl.textContent = `${heapUsedMb}MB / ${heapTotalMb}MB (RSS: ${rssMb}MB)`;
    if (sysTotalMemEl) sysTotalMemEl.textContent = `${freeGb}GB Free / ${totalGb}GB Total`;
    if (sysUptimeEl) sysUptimeEl.textContent = `${uptimeHrs} hours`;
  }

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

  // Render Control Centre sections
  renderControlCentreRouting();
  renderControlCentreMemory();
  renderControlCentreKeys();
  renderDockControls();
  renderTokenUsageCards();
  renderEnhancedHealth();

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
    message: value("manualMessage"),
    isAnnouncement: document.getElementById("formatAnnouncement").checked
  };
}

function selectedGroups() {
  const targetMode = document.getElementById("targetMode")?.value || "selected";
  if (targetMode === "all") {
    return (state.dashboard?.groups || []).map(g => g.id);
  }
  return Array.from(document.getElementById("messageGroups").selectedOptions).map((option) => option.value);
}

function getAdminToken() {
  return localStorage.getItem("aero_admin_token") || "";
}

async function post(url, payload) {
  const token = getAdminToken();
  const res = await fetch(url, {
    method: "POST",
    headers: { 
      "content-type": "application/json",
      "X-Admin-Token": token
    },
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

// Initial refresh is now handled inside checkSession on successful login

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

// ============================================================================
// AI CONTROL CENTRE RENDERERS & EVENT HANDLERS
// ============================================================================

function renderControlCentreRouting() {
  const rowsEl = document.getElementById("routingRows");
  if (!rowsEl) return;
  
  if (state.controlCentre.groups.length === 0) {
    rowsEl.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-muted); padding:20px;">No docks joined yet. Install the bot in groups to map models.</td></tr>`;
    return;
  }

  const modelOptions = [
    { value: "default", label: "Default Fallback Router" },
    { value: "groq-llama-8b", label: "Groq Llama 3.1 8B (Fastest)" },
    { value: "groq-llama-70b", label: "Groq Llama 3.3 70B (Smart)" },
    { value: "groq-deepseek-r1", label: "Groq DeepSeek R1 70B (Reasoning)" },
    { value: "gemini-flash", label: "Gemini 2.5 Flash (Conversational)" },
    { value: "cerebras-llama-70b", label: "Cerebras Llama 70B (High Speed)" },
    { value: "openrouter-deepseek", label: "OpenRouter DeepSeek V3 (Free)" },
    { value: "llm7-qwen", label: "LLM7 Qwen3 (Keyless Free)" }
  ];

  rowsEl.innerHTML = state.controlCentre.groups.map(group => {
    const optionsHtml = modelOptions.map(opt => `
      <option value="${opt.value}" ${group.aiModel === opt.value ? "selected" : ""}>${escapeHtml(opt.label)}</option>
    `).join("");

    const selectId = `routing-select-${group.id}`;
    const btnId = `routing-btn-${group.id}`;

    return `
      <tr style="border-bottom:1px solid var(--line);">
        <td style="padding:12px 8px; font-weight:600; color:var(--text);">${escapeHtml(group.name)} <small style="color:var(--muted); display:block; font-weight:normal; font-family:monospace;">ID: ${escapeHtml(group.id)}</small></td>
        <td style="padding:12px 8px; color:var(--muted);">${group.memberCount} members</td>
        <td style="padding:12px 8px;">
          <select id="${selectId}" class="routing-select">
            ${optionsHtml}
          </select>
        </td>
        <td style="padding:12px 8px; text-align:right;">
          <button id="${btnId}" class="save-routing-btn" onclick="handleSaveRouting('${group.id}', '${selectId}', '${btnId}')">Save Mappings</button>
        </td>
      </tr>
    `;
  }).join("");
}

window.handleSaveRouting = async function(groupId, selectId, btnId) {
  const btn = document.getElementById(btnId);
  const select = document.getElementById(selectId);
  if (!btn || !select) return;
  
  const aiModel = select.value;
  setLoading(btn, true);
  try {
    const res = await post("/api/control-centre/groups/model", { groupId, aiModel });
    if (res.success) {
      showToast("AI model mappings updated successfully!", "success");
      await refresh();
    } else {
      showToast("Failed to update mapping: " + (res.error || "unknown"), "error");
    }
  } catch (e) {
    showToast("Mapping update error: " + e.message, "error");
  }
  setLoading(btn, false);
};

function renderControlCentreMemory(filterText = "") {
  const rowsEl = document.getElementById("memoryRows");
  if (!rowsEl) return;

  const memories = state.controlCentre.memories || [];
  const query = filterText.toLowerCase();
  
  const filtered = memories.filter(mem => {
    if (!query) return true;
    if (mem.id.toLowerCase().includes(query)) return true;
    
    // Check if query is in any fact key/value
    return Object.entries(mem.facts || {}).some(([k, v]) => 
      k.toLowerCase().includes(query) || String(v).toLowerCase().includes(query)
    );
  });

  if (filtered.length === 0) {
    rowsEl.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:20px;">No matching user memories found.</td></tr>`;
    return;
  }

  rowsEl.innerHTML = filtered.map(mem => {
    const factsArray = Object.entries(mem.facts || {});
    const factsPreview = factsArray.length > 0
      ? factsArray.map(([k, v]) => `<span style="color:var(--accent); font-weight:600;">${escapeHtml(k)}:</span> ${escapeHtml(v)}`).join(" | ")
      : `<span style="color:var(--muted); font-style:italic;">No facts learned yet.</span>`;

    // Clean user ID for safe element IDs
    const btnId = `mem-btn-${mem.id.replace(/[^a-zA-Z0-9]/g, "-")}`;

    return `
      <tr style="border-bottom:1px solid var(--line);">
        <td style="padding:12px 8px; font-weight:600; font-family:monospace; color:var(--text);">${escapeHtml(mem.id)}</td>
        <td style="padding:12px 8px; color:var(--text); text-align:center;">${mem.factsCount}</td>
        <td style="padding:12px 8px; font-size:12.5px; max-width:400px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(factsArray.map(([k,v])=>`${k}: ${v}`).join("\n"))}">${factsPreview}</td>
        <td style="padding:12px 8px; color:var(--muted); text-align:center;">${mem.interactionCount} chats</td>
        <td style="padding:12px 8px; text-align:right;">
          <button id="${btnId}" class="clear-memory-btn" onclick="handleClearUserMemory('${mem.id}', '${btnId}')">Clear Memory</button>
        </td>
      </tr>
    `;
  }).join("");
}

window.handleClearUserMemory = async function(userId, btnId) {
  if (!confirm(`Are you sure you want to delete all memory facts for User ID: ${userId}? This will clear everything AI has learned about this user.`)) {
    return;
  }
  
  const btn = document.getElementById(btnId);
  if (!btn) return;

  setLoading(btn, true);
  try {
    const res = await post("/api/control-centre/memory/clear", { userId });
    if (res.success) {
      showToast(`Memory cleared for ${userId}!`, "success");
      await refresh();
    } else {
      showToast("Failed to clear memory: " + (res.error || "unknown"), "error");
    }
  } catch (e) {
    showToast("Clear memory error: " + e.message, "error");
  }
  setLoading(btn, false);
};

function renderControlCentreKeys() {
  const container = document.getElementById("keysGridContainer");
  if (!container) return;

  const keys = state.controlCentre.keys || {};
  const checkedAt = state.controlCentre.keysCheckedAt;

  const keyMeta = [
    { key: "groq", name: "Groq Cloud API", type: "Rotation List", quota: "14,400 req/day", signup: "console.groq.com" },
    { key: "gemini", name: "Google Gemini API", type: "Conversational Chat", quota: "15 RPM Free Tier", signup: "aistudio.google.com" },
    { key: "cerebras", name: "Cerebras Inference API", type: "Ultra High Speed Llama", quota: "Free Preview", signup: "cloud.cerebras.ai" },
    { key: "openrouter", name: "OpenRouter API", type: "Free DeepSeek Fallback", quota: "Varies per model", signup: "openrouter.ai" },
    { key: "serper", name: "Serper.dev Google Search", type: "Web Search Grounding", quota: "2,500 queries free", signup: "serper.dev" },
    { key: "tavily", name: "Tavily Search AI", type: "Web Search Summary", quota: "1,000 queries free", signup: "tavily.com" },
    { key: "weather", name: "OpenWeatherMap API", type: "Weather Utility", quota: "60/min, 1M/month", signup: "openweathermap.org" },
    { key: "news", name: "NewsAPI org", type: "News Utility", quota: "100 queries/day", signup: "newsapi.org" },
    { key: "movies", name: "TMDB Movies Database", type: "Movies/TV Utility", quota: "Rate limited only", signup: "themoviedb.org" },
    { key: "recipes", name: "Spoonacular API", type: "Recipes/Food Utility", quota: "150 requests/day", signup: "spoonacular.com" }
  ];

  const timeString = checkedAt
    ? `Verified: ${new Date(checkedAt).toLocaleTimeString()}`
    : "Not verified in this session";

  const footerEl = document.querySelector("#panelKeys .panel-desc");
  if (footerEl) {
    footerEl.textContent = `Live status of credentials configured in your environment. Verification executes pings to check validity. (${timeString})`;
  }

  if (Object.keys(keys).length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 30px; border:1px dashed var(--line); border-radius:8px;">
        API keys are configured in .env. Click "Verify Keys Now" to check their live health and check responses.
      </div>
    `;
    return;
  }

  container.innerHTML = keyMeta.map(meta => {
    const statusObj = keys[meta.key] || { status: "Missing", message: "Not checked" };
    const status = statusObj.status || "Missing";
    const statusLower = status.toLowerCase();
    const isMissing = statusLower === "missing";
    
    let preview = statusObj.keyPreview || "None";
    let message = statusObj.message || "Not configured";
    
    if (meta.key === "groq" && statusObj.keys) {
      const activeKeys = statusObj.keys.filter(k => k.status === "Active").length;
      preview = `${activeKeys}/${statusObj.keys.length} OK`;
    }

    return `
      <div class="key-card">
        <div class="key-card-header">
          <span class="key-card-title">${escapeHtml(meta.name)}</span>
          <span class="key-status-badge ${statusLower}">${escapeHtml(status)}</span>
        </div>
        <div class="key-card-body">
          <div style="font-size:11px; font-weight:600; color:var(--accent-2); margin-bottom:4px;">${escapeHtml(meta.type)}</div>
          <div style="margin-bottom:8px; font-size:12.5px; color:${isMissing ? "var(--muted)" : "var(--text)"};">${escapeHtml(message)}</div>
          <div style="font-size:11px; color:var(--text-muted);">Limit: <strong>${meta.quota}</strong></div>
        </div>
        <div class="key-card-footer">
          <span style="font-size:10px; color:var(--text-muted);">Signup: <a href="https://${meta.signup}" target="_blank" style="color:var(--accent); text-decoration:none;">${meta.signup}</a></span>
          <span class="key-preview-text">${escapeHtml(preview)}</span>
        </div>
      </div>
    `;
  }).join("");
}

// ============================================================================
// DOCK CONTROL & METRICS RENDERERS
// ============================================================================

function renderDockControls() {
  const rowsEl = document.getElementById("dockControlRows");
  if (!rowsEl) return;
  
  const groups = state.controlCentre.groups;
  if (groups.length === 0) {
    rowsEl.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:20px;">No docks joined yet.</td></tr>`;
    return;
  }

  rowsEl.innerHTML = groups.map(group => {
    const isEnabled = !group.botDisabled;
    const statusClass = isEnabled ? "enabled" : "disabled";
    const statusText = isEnabled ? "ON" : "OFF";
    const toggleId = `toggle-${group.id}`;
    const slowmodeInputId = `slowmode-${group.id}`;
    const slowmodeBtnId = `slowmode-btn-${group.id}`;

    return `
      <tr style="border-bottom:1px solid var(--line);">
        <td style="padding:12px 8px;">
          <strong style="color:var(--text);">${escapeHtml(group.name)}</strong>
          <small style="color:var(--muted); display:block; font-family:monospace; margin-top:2px;">ID: ${escapeHtml(group.id)}</small>
        </td>
        <td style="padding:12px 8px; color:var(--muted);">${group.memberCount}</td>
        <td style="padding:12px 8px; color:var(--text); font-weight:600;">${(group.messageCount || 0).toLocaleString()}</td>
        <td style="padding:12px 8px; color:var(--accent, #6366f1); font-weight:600;">${(group.aiRequestCount || 0).toLocaleString()}</td>
        <td style="padding:12px 8px; text-align:center;">
          <label class="toggle-switch" title="Toggle AI for this dock">
            <input type="checkbox" id="${toggleId}" ${isEnabled ? 'checked' : ''} onchange="handleToggleDockAI('${group.id}', this)">
            <span class="toggle-slider"></span>
          </label>
          <div class="ai-status-badge ${statusClass}" style="margin-top:6px;">
            <span class="ai-status-dot"></span>
            ${statusText}
          </div>
        </td>
        <td style="padding:12px 8px; text-align:center;">
          <div style="display:flex; align-items:center; justify-content:center; gap:6px;">
            <input type="number" class="slowmode-input" id="${slowmodeInputId}" value="${group.aiSlowmodeSec || 0}" min="0" max="3600" placeholder="0">
            <button class="slowmode-save-btn" id="${slowmodeBtnId}" onclick="handleSetAiSlowmode('${group.id}', '${slowmodeInputId}', '${slowmodeBtnId}')">Set</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

window.handleToggleDockAI = async function(groupId, checkbox) {
  try {
    const res = await post("/api/control-centre/groups/toggle", { groupId });
    if (res.success) {
      showToast(`AI ${res.botDisabled ? 'DISABLED' : 'ENABLED'} for this dock.`, res.botDisabled ? 'info' : 'success');
      await refresh();
    } else {
      showToast("Toggle failed: " + (res.error || "unknown"), "error");
      checkbox.checked = !checkbox.checked;
    }
  } catch (e) {
    showToast("Toggle error: " + e.message, "error");
    checkbox.checked = !checkbox.checked;
  }
};

window.handleSetAiSlowmode = async function(groupId, inputId, btnId) {
  const input = document.getElementById(inputId);
  const btn = document.getElementById(btnId);
  if (!input || !btn) return;
  
  const seconds = parseInt(input.value, 10) || 0;
  btn.disabled = true;
  btn.textContent = '...';
  try {
    const res = await post("/api/control-centre/groups/ai-slowmode", { groupId, seconds });
    if (res.success) {
      showToast(`AI slowmode set to ${res.aiSlowmodeSec}s for this dock.`, 'success');
      await refresh();
    } else {
      showToast("Slowmode update failed: " + (res.error || "unknown"), "error");
    }
  } catch (e) {
    showToast("Slowmode error: " + e.message, "error");
  }
  btn.disabled = false;
  btn.textContent = 'Set';
};

function renderTokenUsageCards() {
  const container = document.getElementById("tokenCardsGrid");
  if (!container) return;
  
  const usage = state.controlCentre.tokenUsage || {};
  const providers = [
    { key: 'groq', name: 'Groq', icon: '⚡' },
    { key: 'cerebras', name: 'Cerebras', icon: '🧠' },
    { key: 'openrouter', name: 'OpenRouter', icon: '🔀' },
    { key: 'huggingface', name: 'HuggingFace', icon: '🤗' },
    { key: 'llm7', name: 'LLM7', icon: '🆓' },
    { key: 'ddg', name: 'DuckDuckGo', icon: '🦆' }
  ];

  const hasData = Object.keys(usage).length > 0;
  if (!hasData) {
    container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 30px; border:1px dashed var(--line); border-radius:8px;">No token usage data available yet.</div>`;
    return;
  }

  container.innerHTML = providers.map(p => {
    const data = usage[p.key] || { requests: 0, promptTokens: 0, completionTokens: 0 };
    const totalTokens = data.promptTokens + data.completionTokens;
    return `
      <div class="token-card ${p.key}">
        <h4>${p.icon} ${escapeHtml(p.name)}</h4>
        <div class="token-requests">${data.requests.toLocaleString()}</div>
        <div style="font-size:0.78em; color:var(--text-muted); margin-bottom:10px;">requests</div>
        <div class="token-stat"><span>Prompt Tokens</span><strong>${data.promptTokens.toLocaleString()}</strong></div>
        <div class="token-stat"><span>Completion Tokens</span><strong>${data.completionTokens.toLocaleString()}</strong></div>
        <div class="token-stat"><span>Total Tokens</span><strong>${totalTokens.toLocaleString()}</strong></div>
      </div>
    `;
  }).join("");
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function renderEnhancedHealth() {
  const sys = state.systemMetrics;
  if (!sys || !sys.cpuUsage) return;

  // CPU gauge
  let cpuPercent = 0;
  if (state._prevMetrics) {
    const timeDiffMs = sys.timestamp - state._prevMetrics.timestamp;
    const cpuDiffUs = (sys.cpuUsage.user + sys.cpuUsage.system) - (state._prevMetrics.cpuUsage.user + state._prevMetrics.cpuUsage.system);
    if (timeDiffMs > 0) {
      const cores = navigator.hardwareConcurrency || 2;
      cpuPercent = Math.min(100, Math.max(0, (cpuDiffUs / 1000) / timeDiffMs / cores * 100));
    }
  }

  const cpuGaugeRing = document.getElementById('cpuGaugeRing');
  const cpuGaugeValue = document.getElementById('cpuGaugeValue');
  if (cpuGaugeRing) {
    const cpuColor = cpuPercent > 80 ? '#ef4444' : cpuPercent > 50 ? '#f97316' : '#6366f1';
    cpuGaugeRing.style.background = `conic-gradient(${cpuColor} ${cpuPercent * 3.6}deg, rgba(100,100,120,0.15) 0deg)`;
  }
  if (cpuGaugeValue) cpuGaugeValue.textContent = cpuPercent.toFixed(1) + '%';

  // Memory gauge
  const heapUsedMb = Math.round(sys.memoryUsage.heapUsed / 1024 / 1024);
  const heapTotalMb = Math.round(sys.memoryUsage.heapTotal / 1024 / 1024);
  const memPercent = heapTotalMb > 0 ? (heapUsedMb / heapTotalMb) * 100 : 0;
  const memGaugeRing = document.getElementById('memGaugeRing');
  const memGaugeValue = document.getElementById('memGaugeValue');
  const memGaugeLabel = document.getElementById('memGaugeLabel');
  if (memGaugeRing) {
    const memColor = memPercent > 80 ? '#ef4444' : memPercent > 50 ? '#f97316' : '#10b981';
    memGaugeRing.style.background = `conic-gradient(${memColor} ${memPercent * 3.6}deg, rgba(100,100,120,0.15) 0deg)`;
  }
  if (memGaugeValue) memGaugeValue.textContent = heapUsedMb + ' MB';
  if (memGaugeLabel) memGaugeLabel.textContent = `${heapUsedMb}MB / ${heapTotalMb}MB`;

  // Network
  const netInValue = document.getElementById('netInValue');
  const netOutValue = document.getElementById('netOutValue');
  if (netInValue && sys.network) netInValue.textContent = formatBytes(sys.network.bytesIn || 0);
  if (netOutValue && sys.network) netOutValue.textContent = formatBytes(sys.network.bytesOut || 0);

  // Uptime
  const uptimeEl = document.getElementById('uptimeGaugeValue');
  if (uptimeEl && sys.system) {
    const hrs = (sys.system.uptime / 3600).toFixed(1);
    uptimeEl.textContent = hrs + 'h';
  }
}
