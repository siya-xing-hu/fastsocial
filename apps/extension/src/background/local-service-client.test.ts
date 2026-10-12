import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_LOCAL_SERVICE_TIMEOUT_MS,
  DEFAULT_LOCAL_SERVICE_TIMEOUT_MS,
  LocalServiceClient,
  LocalServiceError,
  MONITOR_TEST_LOCAL_SERVICE_TIMEOUT_MS,
  TELEGRAM_TEST_LOCAL_SERVICE_TIMEOUT_MS,
  X_TEST_LOCAL_SERVICE_TIMEOUT_MS,
  resolveLocalServiceTimeout,
} from "./local-service-client.ts";

test("local service client reserves a longer default timeout for AI chat", () => {
  assert.ok(AI_LOCAL_SERVICE_TIMEOUT_MS > 60_000);
  assert.equal(resolveLocalServiceTimeout("/health"), DEFAULT_LOCAL_SERVICE_TIMEOUT_MS);
  assert.equal(resolveLocalServiceTimeout("/api/settings"), DEFAULT_LOCAL_SERVICE_TIMEOUT_MS);
  assert.equal(resolveLocalServiceTimeout("/api/ai/chat"), AI_LOCAL_SERVICE_TIMEOUT_MS);
  assert.equal(resolveLocalServiceTimeout("/api/test/ai"), AI_LOCAL_SERVICE_TIMEOUT_MS);
  assert.equal(resolveLocalServiceTimeout("/api/test/x"), X_TEST_LOCAL_SERVICE_TIMEOUT_MS);
  assert.equal(resolveLocalServiceTimeout("/api/accounts/account-1/test"), X_TEST_LOCAL_SERVICE_TIMEOUT_MS);
  for (const path of ['/api/accounts/a/following', '/api/accounts/a/following/u/unfollow', '/api/accounts/a/following/u/refresh'])
    assert.equal(resolveLocalServiceTimeout(path), X_TEST_LOCAL_SERVICE_TIMEOUT_MS);
  assert.equal(resolveLocalServiceTimeout('/api/assistant/chat'), X_TEST_LOCAL_SERVICE_TIMEOUT_MS);
  assert.equal(resolveLocalServiceTimeout('/api/assistant/posting-policy'), X_TEST_LOCAL_SERVICE_TIMEOUT_MS);
  assert.ok(X_TEST_LOCAL_SERVICE_TIMEOUT_MS >= 300_000);
  assert.equal(resolveLocalServiceTimeout("/api/test/telegram"), TELEGRAM_TEST_LOCAL_SERVICE_TIMEOUT_MS);
  assert.equal(
    resolveLocalServiceTimeout("/api/monitors/monitor-1/run"),
    MONITOR_TEST_LOCAL_SERVICE_TIMEOUT_MS,
  );
  assert.equal(resolveLocalServiceTimeout("/api/ai/chat", 1_234), 1_234);
  for (const action of ['preview', 'profile', 'profile/refresh']) {
    assert.equal(resolveLocalServiceTimeout(`/api/workflows/workflow-1/${action}`), MONITOR_TEST_LOCAL_SERVICE_TIMEOUT_MS);
  }
  assert.equal(resolveLocalServiceTimeout('/api/workflows/workflow-1/profile/refresh', 1_234), 1_234);
});

test("local service client reads enveloped and health responses", async () => {
  const urls: string[] = [];
  const responses = [
    new Response(JSON.stringify({ ok: true, data: { value: 1 } }), { headers: { "content-type": "application/json" } }),
    new Response(JSON.stringify({ ok: true, version: "1", apiVersion: 2, uptimeSeconds: 0, database: "ok" }), { headers: { "content-type": "application/json" } }),
  ];
  const client = new LocalServiceClient(async (input) => {
    urls.push(String(input));
    return responses.shift()!;
  });
  assert.deepEqual(await client.request("/api/value"), { value: 1 });
  assert.deepEqual(await client.request("/health"), { ok: true, version: "1", apiVersion: 2, uptimeSeconds: 0, database: "ok" });
  assert.deepEqual(urls, [
    "http://127.0.0.1:5127/api/value",
    "http://127.0.0.1:5127/health",
  ]);
});

test("local service client invokes fetch with the worker global context", async () => {
  let receivedThis: unknown;
  const contextCheckingFetch = (function (this: typeof globalThis) {
    receivedThis = this;
    return Promise.resolve(new Response(
      JSON.stringify({ ok: true, version: "1", apiVersion: 2, uptimeSeconds: 0, database: "ok" }),
      { headers: { "content-type": "application/json" } },
    ));
  }) as typeof fetch;

  const client = new LocalServiceClient(contextCheckingFetch);

  assert.deepEqual(await client.request("/health"), {
    ok: true,
    version: "1",
    apiVersion: 2,
    uptimeSeconds: 0,
    database: "ok",
  });
  assert.equal(receivedThis, globalThis);
});

test("local service client reports API and connection failures", async () => {
  const apiClient = new LocalServiceClient(async () => new Response(
    JSON.stringify({ ok: false, error: { code: "BAD", message: "bad request" } }),
    { status: 400 },
  ));
  await assert.rejects(() => apiClient.request("/bad"), (error: unknown) => {
    return error instanceof LocalServiceError && error.code === "BAD";
  });

  const offlineClient = new LocalServiceClient(async () => { throw new TypeError("offline"); });
  await assert.rejects(() => offlineClient.request("/health"), (error: unknown) => {
    return error instanceof LocalServiceError && error.code === "LOCAL_SERVICE_UNAVAILABLE";
  });
});

test("old servers cannot pass readiness checks or send incomplete account settings to the UI", async () => {
  for (const [path, payload, status] of [
    ["/health", { ok: true, version: "1.0.0", database: "ok" }, 200],
    ["/health", { ok: true, apiVersion: 3, database: "ok" }, 200],
    ["/api/settings", { ok: true, data: { ai: { services: [] }, interactionPrompts: [], x: {}, telegram: {} } }, 200],
    ["/api/accounts", { message: "Route not found" }, 404],
    ["/api/workflows", { message: "Route not found" }, 404],
    ["/api/account-config?username=demo", { message: "Route not found" }, 404],
  ] as const) {
    const client = new LocalServiceClient(async () => new Response(JSON.stringify(payload), { status }));
    await assert.rejects(() => client.request(path), (error: unknown) => {
      return error instanceof LocalServiceError
        && error.code === "LOCAL_SERVICE_INCOMPATIBLE"
        && error.message.includes("docker compose up --build -d");
    });
  }
});

test("current settings load normally and invalid settings fail before rendering", async () => {
  const settings = { accounts: [], ai: { services: [] }, interactionPrompts: [], x: { cookies: [] }, telegram: {} };
  const client = new LocalServiceClient(async () => new Response(JSON.stringify({ ok: true, data: settings })));
  assert.deepEqual(await client.request("/api/settings"), settings);
  const invalid = new LocalServiceClient(async () => new Response(JSON.stringify({ ok: true, data: { accounts: [] } })));
  await assert.rejects(() => invalid.request("/api/settings"), (error: unknown) =>
    error instanceof LocalServiceError && error.code === "LOCAL_SERVICE_INVALID_RESPONSE");
});

test("a missing individual account or an API error is not treated as an offline server", async () => {
  const missing = new LocalServiceClient(async () => new Response(JSON.stringify({ message: "Not found" }), { status: 404 }));
  await assert.rejects(() => missing.request("/api/accounts/deleted"), (error: unknown) =>
    error instanceof LocalServiceError && error.code === "HTTP_404");
  const broken = new LocalServiceClient(async () => new Response(JSON.stringify({ ok: false, error: { code: "INTERNAL_ERROR", message: "Database error" } }), { status: 500 }));
  await assert.rejects(() => broken.request("/api/account-config?username=demo"), (error: unknown) =>
    error instanceof LocalServiceError && error.code === "INTERNAL_ERROR");
});
