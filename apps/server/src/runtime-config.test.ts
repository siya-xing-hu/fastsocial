import assert from "node:assert/strict";
import test from "node:test";
import { resolveHost, resolvePort } from "./runtime-config.ts";

test("runtime config uses the local Docker-facing port by default", () => {
  assert.equal(resolveHost({}), "127.0.0.1");
  assert.equal(resolvePort({}), 5127);
});

test("runtime config accepts container host and port overrides", () => {
  const environment = {
    FAST_SOCIAL_HOST: "0.0.0.0",
    FAST_SOCIAL_PORT: "5199",
  };

  assert.equal(resolveHost(environment), "0.0.0.0");
  assert.equal(resolvePort(environment), 5199);
});

test("runtime config rejects invalid ports", () => {
  assert.throws(
    () => resolvePort({ FAST_SOCIAL_PORT: "not-a-port" }),
    /FAST_SOCIAL_PORT/,
  );
});
