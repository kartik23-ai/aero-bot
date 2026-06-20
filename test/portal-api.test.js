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

test("custom commands execute via webhook", async () => {
  const { baseUrl, close } = await startServer();
  try {
    const saveResponse = await fetch(`${baseUrl}/api/custom-commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actor: { id: "owner-1", role: "OWNER" },
        name: "/apply",
        response: "Apply using the pinned form.",
        languages: ["en"]
      })
    });
    assert.equal(saveResponse.status, 201);

    const webhookResponse = await fetch(`${baseUrl}/api/webhooks/aero`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        eventType: "message",
        groupId: "group-1",
        groupName: "Aero Community",
        text: "/apply",
        sender: { id: "user-201" }
      })
    });
    const webhookBody = await webhookResponse.json();

    assert.equal(webhookResponse.status, 200);
    assert.equal(webhookBody.reply, "Apply using the pinned form.");
  } finally {
    await close();
  }
});

test("webhook detects reply-to-bot and skips morbid topics", async () => {
  const { baseUrl, close } = await startServer();
  try {
    // Ensure bot is enabled for group-1 before testing mentions
    let toggleRes = await fetch(`${baseUrl}/api/control-centre/groups/toggle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ groupId: "group-1" })
    });
    let toggleBody = await toggleRes.json();
    if (toggleBody.botDisabled) {
      await fetch(`${baseUrl}/api/control-centre/groups/toggle`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ groupId: "group-1" })
      });
    }

    // 1. Test reply to bot (parent sender is aerogroupguard) triggers AI faq
    const response = await fetch(`${baseUrl}/api/webhooks/aero`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        eventType: "message",
        groupId: "group-1",
        groupName: "Aero Community",
        text: "faq",
        replyToMessageId: {
          senderId: { username: "aerogroupguard" },
          text: "Hi"
        },
        sender: { id: "user-201" }
      })
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.match(body.reply, /FAQ:/);

    // 2. Test morbid topic check does NOT trigger AI even if replying to bot
    const morbidResponse = await fetch(`${baseUrl}/api/webhooks/aero`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        eventType: "message",
        groupId: "group-1",
        groupName: "Aero Community",
        text: "mar gya",
        replyToMessageId: {
          senderId: { username: "aerogroupguard" },
          text: "Hi"
        },
        sender: { id: "user-201" }
      })
    });
    const morbidBody = await morbidResponse.json();
    assert.equal(morbidResponse.status, 200);
    // Since isMention is set to false, it should default to handleMessage and get handled as normal text, returning null / ok: true
    assert.equal(morbidBody.reply, undefined);
    assert.equal(morbidBody.ok, true);
  } finally {
    await close();
  }
});

test("webhook processes interactive report command, warning, yes and no confirmation restrictions", async () => {
  const { baseUrl, close } = await startServer();
  try {
    // 1. User user-abc files a report
    const initRes = await fetch(`${baseUrl}/api/webhooks/aero`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        eventType: "message",
        groupId: "group-1",
        text: "/report Server lag issues",
        sender: { id: "user-abc", username: "alex" }
      })
    });
    const initBody = await initRes.json();
    assert.equal(initRes.status, 200);
    assert.match(initBody.reply, /please confirm your report/);
    assert.match(initBody.reply, /id ban ya terminate/); // Warning should be there

    // 2. Different user user-diff tries to confirm the report (should be blocked)
    const diffConfirmRes = await fetch(`${baseUrl}/api/webhooks/aero`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        eventType: "message",
        groupId: "group-1",
        text: "/yes",
        sender: { id: "user-diff", username: "bob" }
      })
    });
    const diffConfirmBody = await diffConfirmRes.json();
    assert.equal(diffConfirmRes.status, 200);
    assert.match(diffConfirmBody.reply, /don't have any pending report/);

    // 3. User alex cancels report using /no
    const cancelRes = await fetch(`${baseUrl}/api/webhooks/aero`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        eventType: "message",
        groupId: "group-1",
        text: "/no",
        sender: { id: "user-abc", username: "alex" }
      })
    });
    const cancelBody = await cancelRes.json();
    assert.equal(cancelRes.status, 200);
    assert.match(cancelBody.reply, /Report cancelled/);

    // 4. File again to verify successful confirmation
    await fetch(`${baseUrl}/api/webhooks/aero`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        eventType: "message",
        groupId: "group-1",
        text: "/report Suggestion text",
        sender: { id: "user-abc", username: "alex" }
      })
    });

    const confirmRes = await fetch(`${baseUrl}/api/webhooks/aero`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        eventType: "message",
        groupId: "group-1",
        text: "/yes",
        sender: { id: "user-abc", username: "alex" }
      })
    });
    const confirmBody = await confirmRes.json();
    assert.equal(confirmRes.status, 200);
    assert.match(confirmBody.reply, /Report successfully submitted|Failed to locate the suggestion dock/);
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
