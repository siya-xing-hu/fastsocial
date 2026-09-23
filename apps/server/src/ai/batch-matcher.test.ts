import assert from 'node:assert/strict';
import test from 'node:test';
import { BatchMatcher, batchMessages, estimateTokens, inputSize, INPUT_BUDGET, parseBatchResult, type BatchInput } from './batch-matcher.ts';
import type { AIGateway } from './ai-gateway.ts';
import type { AIChatMessage } from '@fast-social/contracts';
const input: BatchInput = { account: { id: 'u', username: 'example', name: 'E', bio: '', fetchedAt: '' }, memory: {}, context: [], includeBio: true,
  posts: [{ id: '1', platform: 'x', author: 'example', text: 'We are changing Codex limits.', createdAt: '2026-09-23T10:00:00Z', url: '', type: 'post' }, { id: '2', platform: 'x', author: 'example', text: 'The reset arrives next Tuesday. hhh', createdAt: '2026-09-23T10:05:00Z', url: '', type: 'post' }], rules: [{ id: 'r', prompt: 'Codex reset', postIds: ['1', '2'] }] };
const response = { decisions: [{ postId: '1', ruleId: 'r', status: 'no_match', reason: '未给时间', evidenceIds: [] }, { postId: '2', ruleId: 'r', status: 'match', reason: '前帖说明 Codex，后帖给重置时间', evidenceIds: ['1', '2'], eventTime: 'next Tuesday，时区未知' }], memory: null };

test('batch prompt carries both posts, author time and the no-invented-context constraint', () => {
  const messages = batchMessages(input);
  assert.match(messages[0]!.content, /reset 不能因规则提到 Codex/);
  assert.match(messages[1]!.content, /We are changing Codex limits/);
  assert.match(messages[1]!.content, /The reset arrives next Tuesday/);
  assert.equal(parseBatchResult(JSON.stringify(response), input).decisions[1]!.status, 'match');
});

test('malformed, missing, duplicated and fabricated decisions fail validation', () => {
  for (const value of [ {}, { ...response, decisions: response.decisions.slice(1) }, { ...response, decisions: [...response.decisions, response.decisions[0]] }, { ...response, decisions: response.decisions.map(item => ({ ...item, evidenceIds: ['made-up'] })) } ]) {
    assert.throws(() => parseBatchResult(JSON.stringify(value), input));
  }
});

test('profile updates need real evidence and remain under 250 characters', () => {
  for (const fact of [ { text: 'maybe', kind: 'inferred', evidenceIds: ['fake'] }, { text: '长'.repeat(251), kind: 'explicit', evidenceIds: ['1'] } ]) {
    assert.throws(() => parseBatchResult(JSON.stringify({ ...response, memory: { topics: fact } }), input));
  }
  const valid = parseBatchResult(JSON.stringify({ ...response, memory: { topics: { text: '讨论 Codex 额度', evidenceIds: ['1'], kind: 'explicit' } } }), input);
  assert.equal(valid.memory?.topics?.text, '讨论 Codex 额度');
});

test('profile array fields report their actual format error instead of missing evidence', () => {
  const fact = { text: '讨论 Codex 额度', evidenceIds: ['1'], kind: 'explicit' };
  for (const section of ['topics', 'language']) {
    assert.throws(() => parseBatchResult(JSON.stringify({ ...response, memory: { [section]: [fact] } }), input), new RegExp(`${section} 必须为单个对象`));
  }
  assert.throws(() => parseBatchResult(JSON.stringify({ ...response, memory: { topics: { ...fact, evidenceIds: ['invented'] } } }), input), /引用了未提供的证据/);
  assert.throws(() => parseBatchResult(JSON.stringify({ ...response, memory: { topics: { ...fact, text: '第一行\n第二行' } } }), input), /非空单行/);
});

test('first learning corrects array output on its only retry without resending the bad response', async () => {
  const calls: AIChatMessage[][] = [];
  const fact = { text: '讨论 Codex 额度', evidenceIds: ['1'], kind: 'explicit' };
  const matcher = new BatchMatcher({ async complete(_provider: unknown, messages: AIChatMessage[]) {
    calls.push(messages);
    return JSON.stringify({ decisions: [], memory: { topics: calls.length === 1 ? [fact] : fact } });
  } } as unknown as AIGateway);
  const result = await matcher.analyze({ ...input, rules: [] });
  assert.equal(calls.length, 2);
  assert.equal(calls[0]!.length, 2);
  assert.equal(calls[1]!.length, 3);
  assert.deepEqual(calls[1]!.slice(0, 2), calls[0]);
  assert.match(calls[1]![2]!.content, /topics 必须为单个对象/);
  assert.ok(estimateTokens(JSON.stringify(calls[1])) <= inputSize({ ...input, rules: [] }));
  assert.ok(inputSize(input) <= INPUT_BUDGET);
  assert.equal(result.memory?.topics?.text, fact.text);
  assert.deepEqual(result.decisions, []);
});

test('AI retries invalid output once and succeeds, or stops after exactly two failures', async () => {
  let calls = 0;
  const matcher = new BatchMatcher({ async complete() { calls++; return calls === 1 ? '{}' : JSON.stringify(response); } } as unknown as AIGateway);
  await matcher.analyze(input);
  assert.equal(calls, 2);
  calls = 0;
  const requests: AIChatMessage[][] = [];
  const failing = new BatchMatcher({ async complete(_provider: unknown, messages: AIChatMessage[]) { calls++; requests.push(messages); throw new Error('offline'); } } as unknown as AIGateway);
  await assert.rejects(failing.analyze(input), /offline/);
  assert.equal(calls, 2);
  assert.deepEqual(requests[0], requests[1]);
});

test('oversized input fails without paying for an AI call', async () => {
  let calls = 0;
  const matcher = new BatchMatcher({ async complete() { calls++; return '{}'; } } as unknown as AIGateway);
  await assert.rejects(matcher.analyze({ ...input, posts: [{ ...input.posts[0]!, text: '大'.repeat(10000) }] }), /预算/);
  assert.equal(calls, 0);
});
