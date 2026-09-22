import assert from "node:assert/strict";
import test from "node:test";
import type { AIMatchResult, SocialPost } from "@fast-social/contracts";
import type { SocialAdapter } from "../adapters/social-adapter.ts";
import type { AIMatcher } from "../ai/ai-matcher.ts";
import { openDatabase } from "../db/database.ts";
import { MonitorRepository } from "../repositories/monitor-repository.ts";
import type { TelegramNotifier } from "../telegram/telegram-notifier.ts";
import { MonitorRunner } from "./monitor-runner.ts";

const post = (id: string): SocialPost => ({
  id,
  platform: "x",
  author: "example",
  text: `post ${id}`,
  createdAt: new Date(Number(id) * 1000).toISOString(),
  url: `https://x.com/example/status/${id}`,
  type: "post",
});

test("first run creates a baseline without AI or Telegram", async () => {
  const harness = createHarness([post("1"), post("2")], { matched: true, message: "hit" });
  await harness.runner.run(harness.monitorId);
  assert.equal(harness.repository.get(harness.monitorId)?.lastSeenPostId, "2");
  assert.equal(harness.evaluated.length, 0);
  assert.equal(harness.sent.length, 0);
  harness.close();
});

test("an empty first run does not swallow the next new post", async () => {
  const harness = createHarness([], { matched: true, message: "hit" });
  await harness.runner.run(harness.monitorId);
  assert.ok(harness.repository.get(harness.monitorId)?.lastCheckedAt);
  harness.posts.push(post("1"));
  await harness.runner.run(harness.monitorId);
  assert.deepEqual(harness.sent, ["1"]);
  harness.close();
});

test("new posts are evaluated oldest first and matched posts are sent", async () => {
  const harness = createHarness([post("2"), post("3")], { matched: true, message: "hit" });
  harness.repository.updateRunState(harness.monitorId, { lastSeenPostId: "1" });
  await harness.runner.run(harness.monitorId);
  assert.deepEqual(harness.evaluated, ["2", "3"]);
  assert.deepEqual(harness.sent, ["2", "3"]);
  assert.equal(harness.repository.get(harness.monitorId)?.lastSeenPostId, "3");
  harness.close();
});

test("manual test has no cursor side effects", async () => {
  const harness = createHarness([post("8")], { matched: false, message: "" });
  const result = await harness.runner.test(harness.monitorId);
  assert.equal(result.post.id, "8");
  assert.equal(harness.repository.get(harness.monitorId)?.lastSeenPostId, null);
  assert.equal(harness.sent.length, 0);
  harness.close();
});

test("AI failure records the error and still advances the attempted post", async () => {
  const harness = createHarness([post("2")], new Error("AI unavailable"));
  harness.repository.updateRunState(harness.monitorId, { lastSeenPostId: "1" });
  await harness.runner.run(harness.monitorId);
  const saved = harness.repository.get(harness.monitorId);
  assert.equal(saved?.lastSeenPostId, "2");
  assert.equal(saved?.lastError, "AI unavailable");
  harness.close();
});

test("X failure records the error without advancing the cursor", async () => {
  const harness = createHarness([post("2")], { matched: false, message: "" });
  harness.repository.updateRunState(harness.monitorId, { lastSeenPostId: "1" });
  harness.setFetchError(new Error("X unavailable"));
  await assert.rejects(() => harness.runner.run(harness.monitorId), /X unavailable/);
  const saved = harness.repository.get(harness.monitorId);
  assert.equal(saved?.lastSeenPostId, "1");
  assert.equal(saved?.lastError, "X unavailable");
  harness.close();
});

function createHarness(posts: SocialPost[], result: AIMatchResult | Error) {
  const database = openDatabase(":memory:");
  const repository = new MonitorRepository(database);
  const monitor = repository.create({
    name: "test",
    username: "example",
    prompt: "match",
    intervalMinutes: 5,
  });
  const evaluated: string[] = [];
  const sent: string[] = [];
  let fetchError: Error | undefined;
  const social: SocialAdapter = {
    async fetchRecentPosts() {
      if (fetchError) throw fetchError;
      return posts;
    },
  };
  const matcher = {
    async evaluate(_prompt: string, current: SocialPost) {
      evaluated.push(current.id);
      if (result instanceof Error) throw result;
      return result;
    },
  } as AIMatcher;
  const telegram = {
    async send(_message: string, current?: SocialPost) {
      if (current) sent.push(current.id);
    },
  } as TelegramNotifier;
  return {
    repository,
    monitorId: monitor.id,
    evaluated,
    sent,
    posts,
    setFetchError: (error: Error) => { fetchError = error; },
    runner: new MonitorRunner({ monitors: repository, social, matcher, telegram }),
    close: () => database.close(),
  };
}
