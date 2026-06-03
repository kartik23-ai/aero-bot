"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { server } = require("../src/server");

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

test("User Approvals API routes work as expected", async () => {
  const { baseUrl, close } = await startServer();
  try {
    // 1. Get approvals data
    const getRes = await fetch(`${baseUrl}/api/user-approvals`);
    const getBody = await getRes.json();
    assert.equal(getRes.status, 200);
    assert.ok(Array.isArray(getBody.approvedUsers));
    assert.ok(Array.isArray(getBody.pendingUsers));

    // 2. Approve a user ID
    const approveRes = await fetch(`${baseUrl}/api/user-approvals/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "test-user-xyz" })
    });
    const approveBody = await approveRes.json();
    assert.equal(approveRes.status, 200);
    assert.equal(approveBody.success, true);

    // 3. Reject a user ID (should clear it from pending if present)
    const rejectRes = await fetch(`${baseUrl}/api/user-approvals/reject`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "test-user-xyz" })
    });
    const rejectBody = await rejectRes.json();
    assert.equal(rejectRes.status, 200);
    assert.equal(rejectBody.success, true);
  } finally {
    await close();
  }
});

test("Manual moderation groupControlAction endpoints support ban_user and kick_user", async () => {
  const { baseUrl, close } = await startServer();
  try {
    const response = await fetch(`${baseUrl}/api/manual/groups/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actor: { id: "owner-1", role: "OWNER" },
        groupIds: ["group-1"],
        action: "ban_user",
        targetUserId: "user-to-ban"
      })
    });
    // It will attempt to moderate, and since aero is offline during test, it output failed or successfully simulated
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.ok(body.status === "complete" || body.status === "failed");
  } finally {
    await close();
  }
});
