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
  assert.deepEqual(saved.json().data.x, {
    cookies: [{
      id: "legacy-default",
      name: "默认 Cookie",
      enabled: true,
      status: "unchecked",
      cookieConfigured: true,
    }],
    cookieConfigured: true,
  });
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

test("X test route forwards the selected Cookie id", async () => {
  let received: { username: string; cookieId?: string } | undefined;
  const app = createApp({
    socialAdapter: {
      async fetchRecentPosts(username, cookieId) {
        received = { username, cookieId };
        return [{
          id: "post-1",
          platform: "x",
          author: username,
          text: "hello",
          createdAt: "2026-01-01T00:00:00.000Z",
          url: "https://x.com/example/status/post-1",
          type: "post",
        }];
      },
    },
  });
  const response = await app.inject({
    method: "POST",
    url: "/api/test/x",
    payload: { username: "@example", cookieId: "cookie-2" },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(received, { username: "@example", cookieId: "cookie-2" });
  assert.equal(response.json().data.username, "example");
  await app.close();
});

test("AI options only expose enabled models with a configured key", async () => {
  const app = createApp();
  const saved = await app.inject({
    method: "PUT",
    url: "/api/settings",
    payload: {
      ai: {
        defaultProvider: "missing-key:test-model",
        services: [
          {
            id: "missing-key",
            name: "Missing key",
            endpoint: "https://example.com/v1/chat/completions",
            enabled: true,
            models: [{ name: "test-model" }],
          },
        ],
      },
    },
  });
  assert.equal(saved.statusCode, 200);

  const response = await app.inject({ method: "GET", url: "/api/ai/options" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().data.options, []);
  await app.close();
});

test("settings API validates and preserves the AI interface format", async () => {
  const app = createApp();
  const saved = await app.inject({
    method: "PUT",
    url: "/api/settings",
    payload: {
      ai: {
        defaultProvider: "anthropic:model",
        services: [{
          id: "anthropic",
          name: "Anthropic gateway",
          endpoint: "http://host.docker.internal:3000/v1/messages",
          apiFormat: "anthropic",
          apiKey: "secret",
          enabled: true,
          models: [{ name: "model" }],
        }],
      },
    },
  });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().data.ai.services[0].apiFormat, "anthropic");

  const invalid = await app.inject({
    method: "PUT",
    url: "/api/settings",
    payload: {
      ai: {
        defaultProvider: "",
        services: [{
          id: "bad",
          name: "Bad",
          endpoint: "https://example.com",
          apiFormat: "other",
          enabled: true,
          models: [{ name: "model" }],
        }],
      },
    },
  });
  assert.equal(invalid.statusCode, 400);
  await app.close();
});

test("prompts API preserves configured priority and omits disabled prompts", async () => {
  const app = createApp();
  const prompts = [
    {
      id: "second",
      name: "Second",
      scene: "reply",
      prompt: "Second prompt",
      enabled: true,
    },
    {
      id: "hidden",
      name: "Hidden",
      scene: "reply",
      prompt: "Hidden prompt",
      enabled: false,
    },
    {
      id: "first",
      name: "First",
      scene: "reply",
      prompt: "First prompt",
      enabled: true,
    },
  ];
  const saved = await app.inject({
    method: "PUT",
    url: "/api/settings",
    payload: { interactionPrompts: prompts },
  });
  assert.equal(saved.statusCode, 200);

  const response = await app.inject({ method: "GET", url: "/api/prompts" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(
    response.json().data.map((prompt: { id: string }) => prompt.id),
    ["second", "first"],
  );
  await app.close();
});
