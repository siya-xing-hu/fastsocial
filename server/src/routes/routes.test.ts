import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../app.ts";

test("monitor CRUD validates and persists rules", async () => {
  const app = createApp();
  const invalid = await app.inject({
    method: "POST",
    url: "/api/monitors",
    payload: { name: "", username: "x", prompt: "p", intervalMinutes: 0 },
  });
  assert.equal(invalid.statusCode, 400);

  const created = await app.inject({
    method: "POST",
    url: "/api/monitors",
    payload: {
      name: "Codex resets",
      username: "@example",
      prompt: "Notify about Codex resets",
      intervalMinutes: 10,
    },
  });
  assert.equal(created.statusCode, 201);
  const id = created.json().data.id as string;

  const updated = await app.inject({
    method: "PUT",
    url: `/api/monitors/${id}`,
    payload: { enabled: false },
  });
  assert.equal(updated.json().data.enabled, false);

  const listed = await app.inject({ method: "GET", url: "/api/monitors" });
  assert.equal(listed.json().data.length, 1);

  const deleted = await app.inject({
    method: "DELETE",
    url: `/api/monitors/${id}`,
  });
  assert.equal(deleted.statusCode, 200);
  await app.close();
});

test("settings API redacts secrets", async () => {
  const app = createApp();
  const saved = await app.inject({
    method: "PUT",
    url: "/api/settings",
    payload: {
      x: { cookie: "auth_token=test; ct0=csrf" },
      telegram: { botToken: "secret", chatId: "42" },
    },
  });

  assert.equal(saved.statusCode, 200);
  assert.deepEqual(saved.json().data.x, { cookieConfigured: true });
  assert.deepEqual(saved.json().data.telegram, {
    chatId: "42",
    botTokenConfigured: true,
  });
  await app.close();
});

test("settings API rejects invalid secret types", async () => {
  const app = createApp();
  const response = await app.inject({
    method: "PUT",
    url: "/api/settings",
    payload: { x: { cookie: 123 } },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, "VALIDATION_ERROR");
  await app.close();
});
