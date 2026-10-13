import assert from 'node:assert/strict';
import test from 'node:test';
import type { AIChatMessage, SocialPost } from '@fast-social/contracts';
import type { AIGateway } from '../ai/ai-gateway.ts';
import { AIOutputTruncatedError } from '../ai/openai-compatible-client.ts';
import { estimateTokens, INPUT_BUDGET } from '../ai/batch-matcher.ts';
import { WorkflowMatcher, parseWorkflowDecisions } from './matcher.ts';

const posts = (count: number): SocialPost[] => Array.from({ length: count }, (_, i) => ({
  platform: 'x', id: String(2000000000000000000n + BigInt(i)), author: `author${i}`, text: `产品进展 ${i}`,
  type: 'post', url: '', createdAt: '2026-10-10T00:00:00Z',
}));
const result = (items: { postId: string }[]) => JSON.stringify({ matches: items.map(post => ({ postId: post.postId, message: '有明确发布进展' })) });
function fixture(reply?: (items: { postId: string }[], call: number) => string) {
  const calls: AIChatMessage[][] = [];
  const matcher = new WorkflowMatcher({ async complete(_provider, messages, outputTokens) {
    calls.push(messages); assert.equal(outputTokens, 6000);
    const input = JSON.parse(messages[1]!.content);
    return reply ? reply(input.posts, calls.length) : result([...input.posts].reverse());
  } } as AIGateway);
  return { calls, matcher };
}

test('a home page of 20 posts uses one AI request with authors, full text, quotes and exact string IDs', async () => {
  const f = fixture(), input = posts(20);
  input[0] = { ...input[0]!, type: 'reply', quotedText: '引用原文', replyToId: '900', quotedPostId: '901' };
  const decisions = await f.matcher.evaluate('只关注产品发布', [...input, input[0]!]);
  assert.equal(f.calls.length, 1); assert.equal(decisions.length, 20);
  const body = JSON.parse(f.calls[0]![1]!.content);
  assert.equal(body.condition, '只关注产品发布'); assert.equal(body.posts.length, 20);
  assert.deepEqual(body.posts[0], { postId: input[0].id, author: 'author0', text: '产品进展 0', type: 'reply', createdAt: input[0].createdAt, quotedText: '引用原文', quotedPostId: '901', replyToId: '900' });
  assert.equal(decisions[0]?.postId, input.at(-1)?.id);
  assert.match(f.calls[0]![0]!.content, /不可信数据/); assert.match(f.calls[0]![0]!.content, /不能把其他作者/);
});
test('large batches split to the input and output budgets without truncating or dropping a post', async () => {
  for (const input of [posts(65), posts(20).map(post => ({ ...post, text: '详细产品信息。'.repeat(150) }))]) {
    const f = fixture(); const decisions = await f.matcher.evaluate('产品发布', input);
    assert.ok(f.calls.length > 1); assert.ok(f.calls.length < input.length);
    assert.ok(f.calls.every(messages => estimateTokens(JSON.stringify(messages)) <= INPUT_BUDGET));
    const sent = f.calls.flatMap(messages => JSON.parse(messages[1]!.content).posts);
    assert.deepEqual(sent.map(p => [p.postId, p.text]), input.map(p => [p.id, p.text]));
    assert.equal(new Set(decisions.map(d => d.postId)).size, input.length);
  }
});
test('empty input needs no AI and an oversized individual post or condition fails before any request', async () => {
  const f = fixture(); assert.deepEqual(await f.matcher.evaluate('发布', []), []);
  await assert.rejects(f.matcher.evaluate('发布', [...posts(31), { ...posts(1)[0]!, id: 'huge', text: '长'.repeat(10000) }]), /输入预算/);
  await assert.rejects(f.matcher.evaluate('条件'.repeat(10000), posts(1)), /输入预算/);
  assert.equal(f.calls.length, 0);
});
test('batch validation rejects missing arrays, duplicate, foreign or malformed matches and accepts out of order fenced results', () => {
  const input = posts(2), valid = input.map(p => ({ postId: p.id, message: '命中' }));
  assert.deepEqual(parseWorkflowDecisions('```json\n' + JSON.stringify({ matches: [...valid].reverse() }) + '\n```', input), [...valid].reverse().map(d => ({ ...d, matched: true })));
  for (const raw of ['no', '{}', 'null', ...[
    [valid[0], valid[0]], [valid[0], { ...valid[1], postId: 'unknown' }],
    [valid[0], { ...valid[1], postId: Number(input[1]!.id) }],
    [valid[0], { ...valid[1], matched: 'true' }], [valid[0], { ...valid[1], message: '' }],
  ].map(matches => JSON.stringify({ matches }))]) assert.throws(() => parseWorkflowDecisions(raw, input), /AI 批量判断/);
});
test('a failed later batch yields no partial result and truncated output is never treated as a non-match', async () => {
  const f = fixture((items, call) => call === 2 ? '{"matches":[' : result(items));
  await assert.rejects(f.matcher.evaluate('产品发布', posts(35)), /不是有效 JSON/); assert.equal(f.calls.length, 2);
  const truncated = fixture(() => { throw new AIOutputTruncatedError(); });
  await assert.rejects(truncated.matcher.evaluate('产品发布', posts(20)), AIOutputTruncatedError);
  assert.equal(truncated.calls.length, 1);
});
test('cancelled workflows stop between batches', async () => {
  const f = fixture(); let checks = 0;
  await assert.rejects(f.matcher.evaluate('产品发布', posts(65), () => { if (++checks === 3) throw new Error('cancelled'); }), /cancelled/);
  assert.equal(f.calls.length, 1);
});

test('sparse or empty matches still account for every scanned post without AI non-match descriptions', async () => {
  const f = fixture(items => JSON.stringify({ matches: [{ postId: items[3]!.postId, message: '明确命中' }] }));
  const input = posts(20), decisions = await f.matcher.evaluate('产品发布', input);
  assert.equal(decisions.length, 20); assert.equal(decisions.filter(d => d.matched).length, 1);
  assert.ok(decisions.filter(d => !d.matched).every(d => d.message === ''));
  assert.deepEqual(parseWorkflowDecisions('{"matches":[]}', input), input.map(p => ({ postId: p.id, matched: false, message: '' })));
  assert.match(f.calls[0]![0]!.content, /只输出确定命中/);
});
