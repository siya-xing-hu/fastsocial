import assert from "node:assert/strict";
import test from "node:test";
import type { MonitorRunner } from "./monitor-runner.ts";
import { openDatabase } from "../db/database.ts";
import { MonitorRepository } from "../repositories/monitor-repository.ts";
import { MonitorScheduler } from "./scheduler.ts";

test("scheduler runs only due enabled monitors", async () => {
  const database = openDatabase(":memory:");
  const repository = new MonitorRepository(database);
  const due = repository.create({ name: "due", username: "a", prompt: "p", intervalMinutes: 1 });
  repository.create({ name: "off", username: "b", prompt: "p", intervalMinutes: 1, enabled: false });
  const calls: string[] = [];
  const runner = { async run(id: string) { calls.push(id); } } as MonitorRunner;
  await new MonitorScheduler(repository, runner).tick();
  assert.deepEqual(calls, [due.id]);
  database.close();
});

test("scheduler does not overlap the same monitor", async () => {
  const database = openDatabase(":memory:");
  const repository = new MonitorRepository(database);
  repository.create({ name: "due", username: "a", prompt: "p", intervalMinutes: 1 });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  const runner = { async run() { calls += 1; await gate; } } as unknown as MonitorRunner;
  const scheduler = new MonitorScheduler(repository, runner);
  const first = scheduler.tick();
  await Promise.resolve();
  await scheduler.tick();
  assert.equal(calls, 1);
  release();
  await first;
  database.close();
});
