import assert from 'node:assert/strict';
import test from 'node:test';
import type { AccountMemory, SocialPost } from '@fast-social/contracts';
import { activeMemory, bioSource, type BatchInput, type BatchMatcher } from '../ai/batch-matcher.ts';
import { openDatabase } from '../db/database.ts';
import { AccountRepository } from '../repositories/account-repository.ts';
import { MonitorRepository } from '../repositories/monitor-repository.ts';
import type { TelegramNotifier } from '../telegram/telegram-notifier.ts';
import { MonitorRunner } from './monitor-runner.ts';

const post = (id: string): SocialPost => ({ id, platform: 'x', author: 'example', text: `post ${id}`, createdAt: new Date(Date.now() + Number(id) * 1000).toISOString(), url: `https://x.com/example/status/${id}`, type: 'post' });
function harness(posts: SocialPost[]) {
  const database = openDatabase(':memory:');
  const monitors = new MonitorRepository(database);
  const accounts = new AccountRepository(database);
  const rule = monitors.create({ name: 'test', username: 'example', prompt: 'Codex 重置', intervalMinutes: 5 });
  const calls: BatchInput[] = [];
  const sent: string[] = [];
  const state = { aiError: false, fetchError: false, notifyError: '', pages: 0, bioCalls: 0 };
  const account = { id: 'user-42', username: 'example', name: 'Example', bio: 'AI developer', fetchedAt: new Date().toISOString() };
  const memory: AccountMemory = { topics: { text: 'AI 编程工具', evidenceIds: [bioSource(account)], kind: 'explicit', updatedAt: new Date().toISOString() } };
  const matcher = { fingerprint: () => 'test-model', async analyze(input: BatchInput) {
    calls.push(input);
    if (state.aiError) throw new Error('AI unavailable');
    return { memory, decisions: input.rules.flatMap(rule => rule.postIds.map(postId => ({ postId, ruleId: rule.id, status: 'match' as const, reason: '命中', evidenceIds: [postId] }))) };
  } } as unknown as BatchMatcher;
  const runner = new MonitorRunner({ monitors, accounts, matcher,
    social: {
      async fetchRecentPosts() { return posts; },
      async fetchAccount() { state.bioCalls++; if (state.fetchError) throw new Error('X unavailable'); return account; },
      async fetchTimelinePage(_account, cursor, surface) {
        state.pages++;
        if (state.fetchError) throw new Error('X unavailable');
        if (surface === 'replies') return { posts: [], nextCursor: null };
        const offset = Number(cursor ?? 0);
        const ordered = [...posts].reverse();
        return { posts: ordered.slice(offset, offset + 40), nextCursor: offset + 40 < posts.length ? String(offset + 40) : null };
      },
    }, telegram: { async send(_message: string, current?: SocialPost) {
      if (current?.id === state.notifyError) throw new Error('Telegram unavailable');
      if (current) sent.push(current.id);
    } } as TelegramNotifier,
  });
  return { database, monitors, accounts, rule, runner, calls, sent, posts, state, account, memory, close: () => database.close() };
}

test('cold start learns bio and latest 20 posts once, without notifying history', async () => {
  const h = harness(Array.from({ length: 60 }, (_, i) => post(String(i + 1))));
  await h.runner.run(h.rule.id);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0]!.posts.length, 20);
  assert.equal(h.calls[0]!.posts[0]!.id, '41');
  assert.equal(h.calls[0]!.includeBio, true);
  assert.deepEqual(h.sent, []);
  assert.equal(h.monitors.get(h.rule.id)?.lastSeenPostId, '60');
  await h.runner.run(h.rule.id);
  assert.equal(h.calls.length, 1);
  assert.equal(h.state.bioCalls, 1);
  h.close();
});

test('empty initial timeline does not swallow a later new post', async () => {
  const h = harness([]);
  await h.runner.run(h.rule.id);
  h.posts.push(post('1'));
  await h.runner.run(h.rule.id);
  assert.deepEqual(h.sent, ['1']);
  h.close();
});

test('migrated cursor is retained during learning and 85 new posts are paged and batched', async () => {
  const h = harness(Array.from({ length: 86 }, (_, i) => post(String(i + 1))));
  h.monitors.updateRunState(h.rule.id, { lastSeenPostId: '1' });
  await h.runner.run(h.rule.id);
  assert.equal(h.state.pages, 4);
  assert.deepEqual(h.calls.map(call => call.posts.length), [30, 30, 25]);
  assert.equal(h.sent.length, 85);
  assert.equal(h.monitors.get(h.rule.id)?.lastSeenPostId, '86');
  assert.equal(h.accounts.posts(h.account.id).length, 86);
  h.close();
});

test('AI failure keeps offset; next schedule compensates from the same offset', async () => {
  const h = harness([post('1'), post('2')]);
  h.monitors.updateRunState(h.rule.id, { lastSeenPostId: '1' });
  h.state.aiError = true;
  await assert.rejects(h.runner.run(h.rule.id), /AI unavailable/);
  assert.equal(h.monitors.get(h.rule.id)?.lastSeenPostId, '1');
  assert.equal(h.accounts.profile(h.account.id), null);
  h.state.aiError = false;
  await h.runner.run(h.rule.id);
  assert.deepEqual(h.sent, ['2']);
  h.close();
});

test('failure during initial learning stays a baseline run on the next schedule', async () => {
  const h = harness([post('1'), post('2')]);
  h.state.aiError = true;
  await assert.rejects(h.runner.run(h.rule.id));
  assert.equal(h.monitors.get(h.rule.id)?.lastSeenPostId, null);
  h.state.aiError = false;
  await h.runner.run(h.rule.id);
  assert.deepEqual(h.sent, []);
  assert.equal(h.monitors.get(h.rule.id)?.lastSeenPostId, '2');
  h.close();
});

test('a successful notification is not repeated after a later notification fails', async () => {
  const h = harness([post('2'), post('3')]);
  h.monitors.updateRunState(h.rule.id, { lastSeenPostId: '1' });
  h.state.notifyError = '3';
  await assert.rejects(h.runner.run(h.rule.id));
  assert.equal(h.monitors.get(h.rule.id)?.lastSeenPostId, '1');
  h.state.notifyError = '';
  await h.runner.run(h.rule.id);
  assert.deepEqual(h.sent, ['2', '3']);
  h.close();
});

test('manual batch test is cached and has no profile, cursor, post archive or Telegram side effects', async () => {
  const h = harness([post('8'), post('9')]);
  const first = await h.runner.test(h.rule.id);
  assert.equal(first.posts.length, 2);
  const second = await h.runner.test(h.rule.id);
  assert.equal(second.cached, true);
  assert.equal(h.calls.length, 1);
  assert.equal(h.accounts.profile(h.account.id), null);
  assert.equal(h.accounts.posts(h.account.id).length, 0);
  assert.equal(h.monitors.get(h.rule.id)?.lastSeenPostId, null);
  assert.deepEqual(h.sent, []);
  h.close();
});

test('due rules for one account share one batch and use their individual cursors', async () => {
  const h = harness([post('1'), post('2'), post('3')]);
  const other = h.monitors.create({ name: 'other', username: 'example', prompt: 'other', intervalMinutes: 60 });
  const idle = h.monitors.create({ name: 'idle', username: 'example', prompt: 'idle', intervalMinutes: 60 });
  h.monitors.updateRunState(h.rule.id, { lastSeenPostId: '1' });
  h.monitors.updateRunState(other.id, { lastSeenPostId: '2' });
  await h.runner.runMany([h.rule.id, other.id]);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0]!.rules.map(rule => rule.postIds), [['2', '3'], ['3']]);
  assert.equal(h.monitors.get(idle.id)?.lastSeenPostId, null);
  h.close();
});

test('fetch failure records phase without changing offset', async () => {
  const h = harness([post('2')]);
  h.monitors.updateRunState(h.rule.id, { lastSeenPostId: '1' });
  h.state.fetchError = true;
  await assert.rejects(h.runner.run(h.rule.id), /X unavailable/);
  assert.equal(h.monitors.get(h.rule.id)?.lastSeenPostId, '1');
  assert.equal(h.accounts.status(h.rule.id)?.phase, 'fetch');
  h.close();
});

test('manual correction and clearing are shared, versioned and never relearn old history', async () => {
  const h = harness([post('1')]);
  await h.runner.run(h.rule.id);
  const edited = await h.runner.editProfile(h.rule.id, '用语：reset 仅在明确讨论额度时指重置。');
  assert.equal(edited.profile?.memory.language?.kind, 'manual');
  await h.runner.editProfile(h.rule.id, '');
  await h.runner.run(h.rule.id);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.runner.profile(h.rule.id).profile?.memory, {});
  h.close();
});

test('expired recent context and inferred facts do not become perpetual evidence', () => {
  const old = { text: 'old', kind: 'inferred' as const, evidenceIds: ['1'], updatedAt: new Date(Date.now() - 31 * 86400000).toISOString() };
  assert.deepEqual(activeMemory({ topics: old, recent: old }), {});
  assert.ok(activeMemory({ topics: { ...old, kind: 'manual' } }).topics);
});

test('a failure in a later batch leaves the whole window uncommitted', async () => {
  const h = harness(Array.from({ length: 45 }, (_, i) => post(String(i + 2))));
  h.monitors.updateRunState(h.rule.id, { lastSeenPostId: '1' });
  // Fail after the first batch has returned, before anything is sent or committed.
  const originalPush = h.calls.push.bind(h.calls);
  h.calls.push = (...items) => {
    const size = originalPush(...items);
    if (size === 2) h.state.aiError = true;
    return size;
  };
  await assert.rejects(h.runner.run(h.rule.id), /AI unavailable/);
  assert.equal(h.monitors.get(h.rule.id)?.lastSeenPostId, '1');
  assert.equal(h.accounts.profile(h.account.id), null);
  assert.deepEqual(h.sent, []);
  h.close();
});

test('a rule changed while AI is running cannot send or advance stale results', async () => {
  const h = harness([post('2')]);
  h.monitors.updateRunState(h.rule.id, { lastSeenPostId: '1' });
  const originalPush = h.calls.push.bind(h.calls);
  h.calls.push = (...items) => {
    h.monitors.update(h.rule.id, { prompt: 'a different condition' });
    return originalPush(...items);
  };
  await assert.rejects(h.runner.run(h.rule.id), /规则已修改/);
  assert.equal(h.monitors.get(h.rule.id)?.lastSeenPostId, '1');
  assert.deepEqual(h.sent, []);
  h.close();
});

test('failed and unprocessed posts survive pruning, while old completed posts expire', async () => {
  const h = harness([post('1'), post('2')]);
  await h.runner.run(h.rule.id);
  const old = new Date(Date.now() - 40 * 86400000).toISOString();
  h.accounts.savePosts(h.account.id, [ { ...post('1'), createdAt: old }, { ...post('3'), createdAt: old } ]);
  h.accounts.prunePosts(h.account.id, h.account.username);
  assert.deepEqual(h.accounts.posts(h.account.id).map(post => post.id).sort(), ['2', '3']);
  h.close();
});
