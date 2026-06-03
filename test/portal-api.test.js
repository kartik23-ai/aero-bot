"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { server } = require("../src/server");

test("portal API exposes owner/admin/user capabilities", async () => {
  const { baseUrl, close } = await startServer();
  try {
    const response = await fetch(`${baseUrl}/api/portal`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.ok(body.ownerPortal.capabilities.includes("manage_admins"));
    assert.ok(body.adminPortal.capabilities.includes("review_reports"));
    assert.ok(body.userPortal.capabilities.includes("submit_reports"));
  } finally {
    await close();
  }
});

test("manual control denies dashboard users without control access", async () => {
  const { baseUrl, close } = await startServer();
  try {
    const response = await fetch(`${baseUrl}/api/manual/messages/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actor: { id: "user-1", role: "USER" },
        groupIds: ["group-1"],
        message: "Hello"
      })
    });
    const body = await response.json();

    assert.equal(response.status, 403);
    assert.equal(body.error, "Permission denied.");
  } finally {
    await close();
  }
});

test("manual message preview estimates recipients", async () => {
  const { baseUrl, close } = await startServer();
  try {
    const response = await fetch(`${baseUrl}/api/manual/messages/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ groupIds: ["group-1"], message: "Maintenance notice" })
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.preview.groups, ["group-1"]);
    assert.equal(body.preview.estimatedRecipients, 1240);
  } finally {
    await close();
  }
});

test("owner can create no-code custom commands", async () => {
  const { baseUrl, close } = await startServer();
  try {
    const response = await fetch(`${baseUrl}/api/custom-commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actor: { id: "owner-1", role: "OWNER" },
        name: "/apply",
        response: "Apply using the pinned form.",
        languages: ["en"]
      })
    });
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.equal(body.command.name, "/apply");
  } finally {
    await close();
  }
});

test("webhook auto-welcomes member join events", async () => {
  const { baseUrl, close } = await startServer();
  try {
    const response = await fetch(`${baseUrl}/api/webhooks/aero`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        eventType: "member_join",
        groupId: "group-1",
        groupName: "Aero Community",
        member: { id: "user-200", mention: "@newuser" }
      })
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.eventType, "member_join");
    assert.match(body.reply, /Welcome to the group, @newuser/);
    assert.equal(body.sendAction.reason, "welcome");
  } finally {
    await close();
  }
});

test("webhook auto-replies to mention commands", async () => {
  const { baseUrl, close } = await startServer();
  try {
    const response = await fetch(`${baseUrl}/api/webhooks/aero`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        eventType: "message",
        groupId: "group-1",
        groupName: "Aero Community",
        text: "@AeroGroupGuard faq",
        sender: { id: "user-201" }
      })
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.match(body.reply, /FAQ:/);
    assert.equal(body.sendAction.status, "queued_for_auto_send");
  } finally {
    await close();
  }
});

function startServer() {
  return new Promise((resolve) => {
    const listener = server.listen(0, () => {
      const address = listener.address();
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((done) => listener.close(done))
      });
    });
  });
}
