import { XRequestQueue } from '../adapters/x/request-queue.ts';
import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../app.ts";

test("monitor CRUD validates and persists rules", async () => {
  const app = createApp({ xRequestQueue: new XRequestQueue({ intervalMs: 0 }) });
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
  const app = createApp({ xRequestQueue: new XRequestQueue({ intervalMs: 0 }) });
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
  const app = createApp({ xRequestQueue: new XRequestQueue({ intervalMs: 0 }) });
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
  const app = createApp({ xRequestQueue: new XRequestQueue({ intervalMs: 0 }),
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
  const app = createApp({ xRequestQueue: new XRequestQueue({ intervalMs: 0 }) });
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
  const app = createApp({ xRequestQueue: new XRequestQueue({ intervalMs: 0 }) });
  for (const apiFormat of ["openai", "responses", "anthropic"]) {
    const endpoint = `http://host.docker.internal:3000/custom/${apiFormat}`;
    const saved = await app.inject({
      method: "PUT",
      url: "/api/settings",
      payload: {
        ai: {
          defaultProvider: "gateway:model",
          services: [{
            id: "gateway",
            name: "AI gateway",
            endpoint,
            apiFormat,
            apiKey: "secret",
            enabled: true,
            models: [{ name: "model" }],
          }],
        },
      },
    });
    assert.equal(saved.statusCode, 200);
    assert.equal(saved.json().data.ai.services[0].apiFormat, apiFormat);

    const listed = await app.inject({ method: "GET", url: "/api/settings" });
    const service = listed.json().data.ai.services[0];
    assert.equal(service.apiFormat, apiFormat);
    assert.equal(service.endpoint, endpoint);
    assert.equal(service.apiKeyConfigured, true);
    assert.equal(service.apiKey, undefined);
  }

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
  const app = createApp({ xRequestQueue: new XRequestQueue({ intervalMs: 0 }) });
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

test('AI test and chat routes reject blank model output and preserve nonblank text verbatim', async () => {
  let content = ' \n\t ', requests = 0;
  const app = createApp({ xRequestQueue: new XRequestQueue({ intervalMs: 0 }), fetchImpl: async url => {
    assert.equal(String(url), 'https://ai.example/chat/completions');
    requests++;
    return Response.json({ choices: [{ message: { content }, finish_reason: 'stop' }] });
  } });
  try {
    const saved = await app.inject({ method: 'PUT', url: '/api/settings', payload: { ai: {
      defaultProvider: 'test:model', services: [{ id: 'test', name: 'Test AI', endpoint: 'https://ai.example/chat/completions',
        apiKey: 'test-key', enabled: true, models: [{ name: 'model' }] }],
    } } });
    assert.equal(saved.statusCode, 200);
    for (const url of ['/api/test/ai', '/api/ai/chat']) {
      const response = await app.inject({ method: 'POST', url, payload: { messages: [{ role: 'user', content: '测试' }] } });
      assert.equal(response.statusCode, 500);
      assert.equal(response.json().ok, false);
      assert.match(response.json().error.message, /空内容/);
    }
    const stream = await app.inject({ method: 'POST', url: '/api/ai/chat', payload: {
      stream: true, messages: [{ role: 'user', content: '测试' }],
    } });
    const frames = stream.body.trim().split('\n').map(line => JSON.parse(line));
    assert.match(frames.at(-1).error, /空内容/);
    assert.ok(frames.every(frame => !frame.done));
    assert.equal(requests, 3);

    content = '  ```json\n{"example":true}\n```  ';
    const chat = await app.inject({ method: 'POST', url: '/api/ai/chat', payload: { messages: [{ role: 'user', content: '保留格式' }] } });
    assert.equal(chat.statusCode, 200); assert.equal(chat.json().data, content);
    const testResult = await app.inject({ method: 'POST', url: '/api/test/ai', payload: {} });
    assert.equal(testResult.statusCode, 200); assert.equal(testResult.json().data.content, content);
    assert.equal(requests, 5);
  } finally { await app.close(); }
});
