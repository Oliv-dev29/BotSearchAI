const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const express = require("express");
const db = require("../backend/db");

process.env.JWT_SECRET = "test-secret-for-admin-password-change";
require("../backend/initDb");

const adminRouter = require("../backend/routes/admin");

let server;
let baseUrl;
let userId;
const username = `password-change-test-${Date.now()}`;
const currentPassword = "Current-password-123";
const newPassword = "New-password-456";

test.before(async () => {
  const passwordHash = await bcrypt.hash(currentPassword, 12);
  const result = db
    .prepare(
      `INSERT INTO users
        (username, password_hash, role, center_id, is_active, must_change_password)
       VALUES (?, ?, 'admin', NULL, 1, 1)`,
    )
    .run(username, passwordHash);
  userId = result.lastInsertRowid;

  const app = express();
  app.use(express.json());
  app.use("/api/admin", adminRouter);
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.close();
  db.prepare("DELETE FROM users WHERE id = ?").run(userId);
});

async function login() {
  const authRouter = require("../backend/routes/auth");
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  const loginServer = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const response = await fetch(`http://127.0.0.1:${loginServer.address().port}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: currentPassword }),
  });
  const data = await response.json();
  await new Promise((resolve) => loginServer.close(resolve));
  return { response, data };
}

test("un admin forcé à changer son mot de passe reçoit 403 sur /api/admin/centers", async () => {
  const { response: loginResponse, data: loginData } = await login();
  assert.equal(loginResponse.status, 200);
  assert.equal(loginData.mustChangePassword, true);

  const response = await fetch(`${baseUrl}/api/admin/centers`, {
    headers: { Authorization: `Bearer ${loginData.token}` },
  });
  const data = await response.json();

  assert.equal(response.status, 403);
  assert.equal(data.code, "PASSWORD_CHANGE_REQUIRED");
});

test("le changement de mot de passe débloque les routes admin et retourne un JWT sans flag", async () => {
  const { data: loginData } = await login();
  const response = await fetch(`${baseUrl}/api/admin/change-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${loginData.token}`,
    },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(data.mustChangePassword, false);

  const centersResponse = await fetch(`${baseUrl}/api/admin/centers`, {
    headers: { Authorization: `Bearer ${data.token}` },
  });
  assert.equal(centersResponse.status, 200);
});
