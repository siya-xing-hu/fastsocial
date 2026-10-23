import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAIChoice, parseAIJson } from './response-content.ts';

test('shared JSON reader accepts one complete document with explicit response wrappers', () => {
  const value = { matches: [], text: '原文 ``` 和 <think> 都是资料' }, json = JSON.stringify(value);
  for (const raw of [
    json, ` \n${json}\n`, `\`\`\`json\n${json}\n\`\`\``, `\`\`\`JSON\r\n${json}\r\n\`\`\``,
    `\`\`\`json ${json} \`\`\``, `\`\`\`json${json}\`\`\``, `\`\`\`${json}\n\`\`\``,
    `\`\`\`\n${json}\n\`\`\``, `判断结果如下：\n\`\`\`json\n${json}\n\`\`\`\n判断结束。`,
    `<think>这里是尚未作为结果的分析 {"matches":["不可采用"]}</think>\n${json}`,
    `<think>分析</think>\n结果：\n\`\`\`json\n${json}\n\`\`\``,
  ]) assert.deepEqual(parseAIJson(raw), value, raw);
  assert.equal(parseAIJson('"原始字符串"'), '原始字符串');
  assert.equal(parseAIJson('null'), null);
  assert.equal(parseAIJson(JSON.stringify(json)), json, 'does not decode a JSON string a second time');
});

test('shared JSON reader rejects malformed, ambiguous and multiple documents without repairs', () => {
  for (const raw of [
    '', '{} {}', '{"matches":[', '结果：{"matches":[]}',
    '```json\n{}', '```javascript\n{}\n```', '```text\n{}\n```',
    '```json\n{}\n```\n```json\n{}\n```', '{}\n```json\n{}\n```',
    '```json\n{}\n```\n[]', '前文 {\n```json\n{}\n```', '```json\n{}\n```\n]',
    '~~~json\n{}\n~~~\n```json\n{}\n```', '```json\n{}\n```\n"另一个值"',
    'null\n结果如下：\n```json\n{}\n```', '```json\n{}\n```\n结束说明\n"另一个 JSON 值"',
    '"另一个未闭合的 JSON 字符串\n结果如下：\n```json\n{}\n```',
    'true\n结果如下：\n```json\n{}\n```', '```json\n{}\n```\n完成\n123',
    '<think>没有闭合\n```json\n{}\n```', '<think>分析</think><think>第二段</think>\n{}',
    '<think><think>嵌套</think></think>\n{}',
  ]) assert.throws(() => parseAIJson(raw), /./, raw);
});

test('shared choice reader normalizes only an explicit single choice', () => {
  const choices = ['chat', 'post', 'reply', 'summary'] as const;
  for (const [raw, expected] of [
    ['post', 'post'], [' POST ', 'post'], ['/Reply', 'reply'], ['"SUMMARY"', 'summary'],
    ['`post`', 'post'], ['`/REPLY`', 'reply'], ['```text\nPOST\n```', 'post'],
    ['```json\n"summary"\n```', 'summary'], ['```\nchat\n```', 'chat'],
    ['{"skill":"/POST"}', 'post'], ['```json\n{"skill":"reply"}\n```', 'reply'],
    ['<think>分析如何回答</think>\nsummary', 'summary'],
  ]) assert.equal(parseAIChoice(raw!, choices, 'skill'), expected, raw);
});

test('choice reader returns null for explanations, malformed and conflicting values', () => {
  for (const raw of [
    '', 'unknown', '选择 post', 'post 或 chat', '//post', '/post /chat', '`post` 或 `chat`', '``post``',
    '"post" "chat"', '["post"]', '{"skill":["post"]}', '{"skill":null}', '{"result":"post"}',
    '{"skill":"post/chat"}', '{"skill":"post","alternative":"chat"}', '{"skill":"post","reason":"选这个"}', '{"skill":"post"}{"skill":"chat"}',
    '{"skill":"post","skill":"chat"}',
    '```text\npost\n```\n```text\nchat\n```', '结果：\n```text\npost\n```',
    '```javascript\npost\n```', '<think>分析未结束\npost', '<think>分析</think><think>更多</think>post',
  ]) assert.equal(parseAIChoice(raw, ['chat', 'post'], 'skill'), null, raw);
  assert.equal(parseAIChoice('{"skill":"post"}', ['post']), null, 'no field is guessed');
});
