import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseXTimeline, parseXUserId } from "./x-parser.ts";

test("parses a user id", () => {
  assert.equal(parseXUserId({ data: { user: { result: { rest_id: "42" } } } }), "42");
});

test("parses timeline posts and ignores cursors", () => {
  const fixture = JSON.parse(
    readFileSync(new URL("./__fixtures__/user-timeline.json", import.meta.url), "utf8"),
  );
  const posts = parseXTimeline(fixture);
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0], {
    id: "200",
    platform: "x",
    author: "example",
    text: "Codex usage resets tomorrow.",
    createdAt: "2026-09-20T12:00:00.000Z",
    url: "https://x.com/example/status/200",
    quotedText: "Original announcement",
    quotedPostId: "100",
    type: "post",
  });
});

test("parses the current web response when the author's screen name lives under core", () => {
  const fixture = JSON.parse(
    readFileSync(new URL("./__fixtures__/user-timeline.json", import.meta.url), "utf8"),
  );
  const tweet = fixture.data.user.result.timeline.timeline.instructions[0].entries[0]
    .content.itemContent.tweet_results.result;
  tweet.core.user_results.result = {
    core: { screen_name: "current_author" },
    legacy: { description: "The screen name is no longer part of legacy." },
  };
  const posts = parseXTimeline(fixture);
  assert.equal(posts.length, 1);
  assert.equal(posts[0]?.author, "current_author");
  assert.equal(posts[0]?.url, "https://x.com/current_author/status/200");
});

test('web timeline pages ignore pinned posts and expose the bottom cursor', async () => {
  const { parseXAccount, parseXTimelinePage } = await import('./x-parser.ts');
  const payload = JSON.parse(readFileSync(new URL("./__fixtures__/user-timeline.json", import.meta.url), "utf8"));
  const instructions = payload.data.user.result.timeline.timeline.instructions;
  const entry = structuredClone(instructions[0].entries[0]);
  entry.content.itemContent.tweet_results.result.rest_id = 'old-pin';
  instructions.unshift({ type: 'TimelinePinEntry', entry });
  const page = parseXTimelinePage(payload, 'example');
  assert.ok(!page.posts.some(post => post.id === 'old-pin'));
  assert.equal(page.posts[0]?.id, '200');
  assert.throws(() => parseXTimelinePage({ data: {} }, 'example'), /结构/);
  const account = parseXAccount({ data: { user: { result: { rest_id: '42', core: { name: 'Example', screen_name: 'example' }, profile_bio: { description: 'developer' } } } } }, 'example');
  assert.equal(account.bio, 'developer');
});
