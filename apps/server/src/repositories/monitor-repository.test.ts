import assert from "node:assert/strict";
import test from "node:test";
import { openDatabase } from "../db/database.ts";
import { MonitorRepository } from "./monitor-repository.ts";

test("monitor repository stores configuration and run state", () => {
  const database = openDatabase(":memory:");
  const repository = new MonitorRepository(database);
  const monitor = repository.create({
    name: "Codex resets",
    username: "@example",
    prompt: "Notify about Codex resets",
    intervalMinutes: 10,
  });

  assert.equal(monitor.username, "example");
  assert.equal(repository.list().length, 1);

  const updated = repository.updateRunState(monitor.id, {
    lastSeenPostId: "123",
    lastCheckedAt: "2026-09-21T00:00:00.000Z",
    lastError: "failed",
  });
  assert.equal(updated?.lastSeenPostId, "123");
  assert.equal(updated?.lastError, "failed");

  assert.equal(repository.delete(monitor.id), true);
  assert.equal(repository.get(monitor.id), null);
  database.close();
});
