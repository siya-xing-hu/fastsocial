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
  assert.equal(resolveLocalServiceTimeout("/api/test/telegram"), TELEGRAM_TEST_LOCAL_SERVICE_TIMEOUT_MS);
  assert.equal(
    resolveLocalServiceTimeout("/api/monitors/monitor-1/run"),
    MONITOR_TEST_LOCAL_SERVICE_TIMEOUT_MS,
  );
  assert.equal(resolveLocalServiceTimeout("/api/ai/chat", 1_234), 1_234);
});

test("local service client reads enveloped and health responses", async () => {
  const urls: string[] = [];
  const responses = [
    new Response(JSON.stringify({ ok: true, data: { value: 1 } }), { headers: { "content-type": "application/json" } }),
    new Response(JSON.stringify({ ok: true, version: "1", uptimeSeconds: 0, database: "ok" }), { headers: { "content-type": "application/json" } }),
  ];
  const client = new LocalServiceClient(async (input) => {
    urls.push(String(input));
    return responses.shift()!;
  });
  assert.deepEqual(await client.request("/api/value"), { value: 1 });
  assert.deepEqual(await client.request("/health"), { ok: true, version: "1", uptimeSeconds: 0, database: "ok" });
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
      JSON.stringify({ ok: true, version: "1", uptimeSeconds: 0, database: "ok" }),
      { headers: { "content-type": "application/json" } },
    ));
  }) as typeof fetch;

  const client = new LocalServiceClient(contextCheckingFetch);

  assert.deepEqual(await client.request("/health"), {
    ok: true,
    version: "1",
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
