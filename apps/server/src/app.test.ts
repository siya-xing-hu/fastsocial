import { XRequestQueue } from './adapters/x/request-queue.ts';
import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "./app.ts";

test("GET /health returns the local service status", async () => {
  const app = createApp({ xRequestQueue: new XRequestQueue({ intervalMs: 0 }), version: "test", startedAt: Date.now() });
  const response = await app.inject({ method: "GET", url: "/health" });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    ok: true,
    apiVersion: 2,
    version: "test",
    uptimeSeconds: 0,
    database: "ok",
  });

  await app.close();
});
