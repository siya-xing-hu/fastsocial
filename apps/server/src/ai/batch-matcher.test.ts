import assert from 'node:assert/strict';
import test from 'node:test';
import { BatchMatcher, batchMessages, inputSize, INPUT_BUDGET, parseBatchResult, type BatchInput } from './batch-matcher.ts';
import type { AIGateway } from './ai-gateway.ts';
import type { AIChatMessage } from '@fast-social/contracts';
import { AIOutputTruncatedError } from './openai-compatible-client.ts';
const input: BatchInput = { account: { id: 'u', username: 'example', name: 'E', bio: '', fetchedAt: '' }, memory: {}, context: [], includeBio: true,
  posts: [{ id: '1', platform: 'x', author: 'example', text: 'We are changing Codex limits.', createdAt: '2026-09-23T10:00:00Z', url: '', type: 'post' }, { id: '2', platform: 'x', author: 'example', text: 'The reset arrives next Tuesday. hhh', createdAt: '2026-09-23T10:05:00Z', url: '', type: 'post' }], rules: [{ id: 'r', prompt: 'Codex reset', postIds: ['1', '2'] }] };
const response = { matches: [{ postId: '2', ruleId: 'r', reason: '前帖说明 Codex，后帖给重置时间', evidenceIds: ['1', '2'], eventTime: 'next Tuesday，时区未知' }] };
const portrait = { ...input, rules: [] };

test('batch prompt carries both posts, author time and the no-invented-context constraint', () => {
  const messages = batchMessages(input);
  assert.match(messages[0]!.content, /reset 不能因规则提到 Codex/);
  assert.match(messages[1]!.content, /We are changing Codex limits/);
  assert.match(messages[1]!.content, /The reset arrives next Tuesday/);
  assert.equal(parseBatchResult(JSON.stringify(response), input).decisions.find(d => d.postId === '2')!.status, 'match');
});

test('malformed, duplicated and fabricated matches fail validation', () => {
  for (const value of [ {}, { matches: null }, { ...response, matches: [...response.matches, response.matches[0]] }, { matches: response.matches.map(item => ({ ...item, evidenceIds: ['made-up'] })) }, { matches: response.matches.map(item => ({ ...item, ruleId: 'other' })) }, { memory: null } ]) {
    assert.throws(() => parseBatchResult(JSON.stringify(value), input));
  }
});

test('portrait length is a prompt guideline, while fabricated evidence still fails', () => {
  assert.throws(() => parseBatchResult(JSON.stringify({ memory: { topics: { text: 'maybe', kind: 'inferred', evidenceIds: ['fake'] } } }), portrait));
  const text = '讨论开发工具与公开产品经验。'.repeat(100);
  const valid = parseBatchResult(JSON.stringify({ memory: { topics: { text, evidenceIds: ['1'], kind: 'explicit' } } }), portrait);
  assert.equal(valid.memory?.topics?.text, text);
  assert.match(batchMessages(portrait)[0]!.content, /建议控制在 150～250 字/);
  assert.match(batchMessages(portrait)[0]!.content, /不设硬性字数上限/);
});

test('profile array fields report their actual format error instead of missing evidence', () => {
  const fact = { text: '讨论 Codex 额度', evidenceIds: ['1'], kind: 'explicit' };
  for (const section of ['topics', 'language']) {
    assert.throws(() => parseBatchResult(JSON.stringify({ memory: { [section]: [fact] } }), portrait), new RegExp(`${section} 必须为单个对象`));
  }
  assert.throws(() => parseBatchResult(JSON.stringify({ memory: { topics: { ...fact, evidenceIds: ['invented'] } } }), portrait), /引用了未提供的证据/);
  assert.throws(() => parseBatchResult(JSON.stringify({ memory: { topics: { ...fact, text: '第一行\n第二行' } } }), portrait), /非空单行/);
});

test('portrait rebuild makes one request and rejects invalid output without repeating generation', async () => {
  const calls: AIChatMessage[][] = [];
  const fact = { text: '讨论 Codex 额度', evidenceIds: ['1'], kind: 'explicit' };
  const matcher = new BatchMatcher({ async complete(_provider: unknown, messages: AIChatMessage[]) {
    calls.push(messages);
    return JSON.stringify({ memory: { topics: calls.length === 1 ? [fact] : fact } });
  } } as unknown as AIGateway);
  await assert.rejects(matcher.analyze(portrait), /topics 必须为单个对象/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.length, 2);
  assert.ok(inputSize(input) <= INPUT_BUDGET);
});

test('AI corrects invalid matches once but never retries network errors at the batch layer', async () => {
  let calls = 0;
  const matcher = new BatchMatcher({ async complete() { calls++; return calls === 1 ? '{}' : JSON.stringify(response); } } as unknown as AIGateway);
  await matcher.analyze(input);
  assert.equal(calls, 2);
  calls = 0;
  const requests: AIChatMessage[][] = [];
  const failing = new BatchMatcher({ async complete(_provider: unknown, messages: AIChatMessage[]) { calls++; requests.push(messages); throw new Error('offline'); } } as unknown as AIGateway);
  await assert.rejects(failing.analyze(input), /offline/);
  assert.equal(calls, 1);
  assert.equal(requests.length, 1);
});

test('oversized input fails without paying for an AI call', async () => {
  let calls = 0;
  const matcher = new BatchMatcher({ async complete() { calls++; return '{}'; } } as unknown as AIGateway);
  await assert.rejects(matcher.analyze({ ...input, posts: [{ ...input.posts[0]!, text: '大'.repeat(10000) }] }), /预算/);
  assert.equal(calls, 0);
});

test('batch matching does not repeat an already exhausted truncation retry', async () => {
  let calls = 0;
  const matcher = new BatchMatcher({ async complete() { calls++; throw new AIOutputTruncatedError(); } } as unknown as AIGateway);
  await assert.rejects(matcher.analyze(input), /监听进度保持不变/);
  assert.equal(calls, 1);
});

test('only valid matching output expands omissions; empty matches means all checked and none matched', () => {
  const result = parseBatchResult(JSON.stringify(response), input);
  assert.equal(result.decisions.length, 2);
  assert.equal(result.decisions.find(d => d.postId === '1')?.status, 'no_match');
  assert.equal(result.memory, null);
  const empty = parseBatchResult('{"matches":[]}', input);
  assert.equal(empty.decisions.length, 2); assert.ok(empty.decisions.every(d => d.status === 'no_match'));
  for (const raw of ['{}', '{"matches":[', '{"matches":null}', '{"matches":[],"memory":null}'])
    assert.throws(() => parseBatchResult(raw, input));
  const messages = batchMessages(input);
  assert.match(messages[0]!.content, /不生成或更新画像/);
  assert.doesNotMatch(batchMessages(portrait)[0]!.content, /必须检查所有 rules/);
});
