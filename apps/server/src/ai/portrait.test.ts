import assert from 'node:assert/strict';
import test from 'node:test';
import type { SocialPost } from '@fast-social/contracts';
import { portraitInput } from './portrait.ts';
import { batchMessages, inputSize, INPUT_BUDGET } from './batch-matcher.ts';

const account = { id: 'u', username: 'example', name: 'Example', bio: 'Developer', fetchedAt: '' };
const post = (n: number): SocialPost => ({ id: String(n), platform: 'x', author: 'example', text: `Post ${n}`,
  createdAt: '2026-10-13T00:00:00Z', url: '', type: 'post' });

test('shared portrait input rebuilds from Profile and the latest 10 unique non-reposts', () => {
  const input = portraitInput(account, [post(3), ...Array.from({ length: 15 }, (_, i) => post(15 - i)), { ...post(16), type: 'repost' }]);
  assert.deepEqual(input.posts.map(p => p.id), ['6', '7', '8', '9', '10', '11', '12', '13', '14', '15']);
  assert.deepEqual([input.memory, input.context, input.rules], [{}, [], []]);
  assert.equal(input.includeBio, true);
  assert.match(batchMessages(input)[0]!.content, /重新构建/);
  assert.doesNotMatch(batchMessages(input)[0]!.content, /任务结束|本轮新增/);
});

test('portrait input reduces the oldest sample to fit its budget without truncating source text', () => {
  const posts = Array.from({ length: 10 }, (_, i) => ({ ...post(i + 1), text: '文'.repeat(800) }));
  const input = portraitInput(account, posts);
  assert.ok(input.posts.length > 0 && input.posts.length < 10);
  assert.ok(inputSize(input) <= INPUT_BUDGET);
  assert.equal(input.posts.at(-1)!.id, '10');
  assert.ok(input.posts.every(p => p.text === '文'.repeat(800)));
  assert.deepEqual(portraitInput(account, []).posts, []);
});
