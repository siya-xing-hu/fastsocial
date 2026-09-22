import assert from "node:assert/strict";
import test from "node:test";
import { parseMatchResult } from "./ai-matcher.ts";

test("parses strict and fenced matcher JSON", () => {
  assert.deepEqual(parseMatchResult('{"matched":true,"message":"reset"}'), {
    matched: true,
    message: "reset",
  });
  assert.deepEqual(parseMatchResult('```json\n{"matched":false,"message":""}\n```'), {
    matched: false,
    message: "",
  });
});

test("rejects malformed matcher output", () => {
  assert.throws(() => parseMatchResult("yes"), /有效 JSON/);
  assert.throws(() => parseMatchResult('{"matched":"yes"}'), /缺少/);
});
