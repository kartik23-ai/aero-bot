"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { server } = require("../src/server");

test("groups control centre endpoints get groups, toggle AI, set slowmode", async () => {
  const { baseUrl, close } = await startServer();
  try {
    // 1. Get initial groups
    const resGet = await fetch(`${baseUrl}/api/control-centre/groups`);
    assert.equal(resGet.status, 200);
    const bodyGet = await resGet.json();
    assert.ok(Array.isArray(bodyGet.groups));

    // If there is a group, let's test toggle and slowmode
    const testGroupId = bodyGet.groups[0]?.id || "group-1";

    // 2. Toggle AI
    const resToggle = await fetch(`${baseUrl}/api/control-centre/groups/toggle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ groupId: testGroupId })
    });
    assert.equal(resToggle.status, 200);
    const bodyToggle = await resToggle.json();
    assert.equal(bodyToggle.success, true);
    assert.equal(typeof bodyToggle.botDisabled, "boolean");

    // 3. Set slowmode
    const resSlow = await fetch(`${baseUrl}/api/control-centre/groups/ai-slowmode`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ groupId: testGroupId, seconds: 15 })
    });
    assert.equal(resSlow.status, 200);
    const bodySlow = await resSlow.json();
    assert.equal(bodySlow.success, true);
    assert.equal(bodySlow.aiSlowmodeSec, 15);
  } finally {
    await close();
  }
});

test("webhook enforces AI toggle and AI slowmode", async () => {
  const { baseUrl, close } = await startServer();
  try {
    const testGroupId = "group-1";

    // First ensure bot is disabled
    const disableRes = await fetch(`${baseUrl}/api/control-centre/groups/toggle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ groupId: testGroupId })
    });
    const disableBody = await disableRes.json();
    
    // If it was toggled to false, toggle it again to make it disabled = true
    if (disableBody.botDisabled === false) {
      await fetch(`${baseUrl}/api/control-centre/groups/toggle`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ groupId: testGroupId })
      });
    }

    // 1. Send mention while AI is disabled. It should return early
    const webhookRes = await fetch(`${baseUrl}/api/webhooks/aero`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        eventType: "message",
        groupId: testGroupId,
        text: "@AeroGroupGuard How are you?",
        sender: { id: "user-test" }
      })
    });
    const webhookBody = await webhookRes.json();
    assert.equal(webhookRes.status, 200);
    assert.equal(webhookBody.reason, "ai_disabled");

    // 2. Enable AI
    await fetch(`${baseUrl}/api/control-centre/groups/toggle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ groupId: testGroupId })
    });

    // 3. Set slowmode to 10 seconds
    await fetch(`${baseUrl}/api/control-centre/groups/ai-slowmode`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ groupId: testGroupId, seconds: 10 })
    });

    // 4. Send mention (success)
    const mention1Res = await fetch(`${baseUrl}/api/webhooks/aero`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        eventType: "message",
        groupId: testGroupId,
        text: "@AeroGroupGuard",
        sender: { id: "user-test" }
      })
    });
    const mention1Body = await mention1Res.json();
    assert.equal(mention1Res.status, 200);
    assert.ok(mention1Body.reply);

    // 5. Send mention again immediately (should trigger slowmode)
    const mention2Res = await fetch(`${baseUrl}/api/webhooks/aero`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        eventType: "message",
        groupId: testGroupId,
        text: "@AeroGroupGuard",
        sender: { id: "user-test" }
      })
    });
    const mention2Body = await mention2Res.json();
    assert.equal(mention2Res.status, 200);
    assert.match(mention2Body.reply, /AI slowmode active/);

    // Reset slowmode
    await fetch(`${baseUrl}/api/control-centre/groups/ai-slowmode`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ groupId: testGroupId, seconds: 0 })
    });
  } finally {
    await close();
  }
});

test("system metrics exposes network bytes", async () => {
  const { baseUrl, close } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/api/system/metrics`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.network);
    assert.equal(typeof body.network.bytesIn, "number");
    assert.equal(typeof body.network.bytesOut, "number");
  } finally {
    await close();
  }
});

test("token usage endpoint returns providers token usage", async () => {
  const { baseUrl, close } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/api/control-centre/token-usage`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.tokenUsage);
    assert.ok(body.tokenUsage.groq);
    assert.ok(body.tokenUsage.cerebras);
    assert.equal(typeof body.tokenUsage.groq.requests, "number");
  } finally {
    await close();
  }
});

test("webhook resolves senderId robustly from different locations and isolates user memory", async () => {
  const { baseUrl, close } = await startServer();
  try {
    const testGroupId = "memory-test-group";

    // 1. Simulate webhook from user-1 (nested object)
    const res1 = await fetch(`${baseUrl}/api/webhooks/aero`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        eventType: "message",
        groupId: testGroupId,
        text: "@AeroGroupGuard My name is Kartik",
        sender: { id: "kartik-id-123", username: "kartik" }
      })
    });
    assert.equal(res1.status, 200);

    // 2. Simulate webhook from user-2 (root direct fields)
    const res2 = await fetch(`${baseUrl}/api/webhooks/aero`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        eventType: "message",
        groupId: testGroupId,
        text: "@AeroGroupGuard My name is Modi",
        senderId: "modi-id-456",
        senderName: "modi"
      })
    });
    assert.equal(res2.status, 200);

    // Verify memories in database
    const { HermesMemory } = require("../src/hermes-memory");
    const kartikMemory = HermesMemory.getUserMemory(`${testGroupId}:kartik-id-123`);
    const modiMemory = HermesMemory.getUserMemory(`${testGroupId}:modi-id-456`);
    const unknownMemory = HermesMemory.getUserMemory(`${testGroupId}:unknown`);

    assert.ok(kartikMemory, "Kartik memory should exist");
    assert.ok(modiMemory, "Modi memory should exist");
    assert.deepEqual(unknownMemory, {}, "Unknown memory should not be updated");

    // Clean up memories
    HermesMemory.clearUserMemory(`${testGroupId}:kartik-id-123`);
    HermesMemory.clearUserMemory(`${testGroupId}:modi-id-456`);
  } finally {
    await close();
  }
});

test("webhook bot remote control command /bot off and /bot on restricted to Yamdut ID", async () => {
  const { baseUrl, close } = await startServer();
  try {
    const testGroupId = "group-1";

    // 1. Send from unauthorized ID
    const resDeny = await fetch(`${baseUrl}/api/webhooks/aero`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        eventType: "message",
        groupId: testGroupId,
        text: "/bot off",
        sender: { id: "some-spammer" }
      })
    });
    const bodyDeny = await resDeny.json();
    assert.equal(resDeny.status, 200);
    assert.match(bodyDeny.reply, /Permission denied/);

    // 2. Send from authorized Yamdut ID to disable bot
    const resAllowOff = await fetch(`${baseUrl}/api/webhooks/aero`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        eventType: "message",
        groupId: testGroupId,
        text: "/bot off",
        sender: { id: "6a040cc5ea8cb0a319b0bb71" }
      })
    });
    const bodyAllowOff = await resAllowOff.json();
    assert.equal(resAllowOff.status, 200);
    assert.match(bodyAllowOff.reply, /disabled for this group/);

    // 3. Send from authorized Yamdut ID to enable bot
    const resAllowOn = await fetch(`${baseUrl}/api/webhooks/aero`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        eventType: "message",
        groupId: testGroupId,
        text: "/bot on",
        sender: { id: "6a040cc5ea8cb0a319b0bb71" }
      })
    });
    const bodyAllowOn = await resAllowOn.json();
    assert.equal(resAllowOn.status, 200);
    assert.match(bodyAllowOn.reply, /enabled for this group/);

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
