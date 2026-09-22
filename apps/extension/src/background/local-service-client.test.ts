import assert from "node:assert/strict";
import test from "node:test";
import { LocalServiceClient, LocalServiceError } from "./local-service-client.ts";

test("local service client reads enveloped and health responses", async () => {
  const responses = [
    new Response(JSON.stringify({ ok: true, data: { value: 1 } }), { headers: { "content-type": "application/json" } }),
    new Response(JSON.stringify({ ok: true, version: "1", uptimeSeconds: 0, database: "ok" }), { headers: { "content-type": "application/json" } }),
  ];
  const client = new LocalServiceClient(async () => responses.shift()!);
  assert.deepEqual(await client.request("/api/value"), { value: 1 });
  assert.deepEqual(await client.request("/health"), { ok: true, version: "1", uptimeSeconds: 0, database: "ok" });
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
