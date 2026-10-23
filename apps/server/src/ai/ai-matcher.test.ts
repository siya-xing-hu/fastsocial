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

test('single-post matching shares explicit JSON wrapper handling without relaxing its fields', () => {
  const json = '{"matched":true,"message":"有依据"}';
  for (const raw of [`结果：\n\`\`\`json\n${json}\n\`\`\``, `<think>分析</think>\n${json}`])
    assert.deepEqual(parseMatchResult(raw), { matched: true, message: '有依据' });
  for (const raw of ['<think>分析</think>{"matched":"true","message":"有依据"}',
    '结果：\n```json\n{"matched":true}\n```', `${json}\n\`\`\`json\n${json}\n\`\`\``])
    assert.throws(() => parseMatchResult(raw), /有效 JSON|缺少/);
});
