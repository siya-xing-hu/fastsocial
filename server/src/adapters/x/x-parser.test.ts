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
    type: "post",
  });
});
