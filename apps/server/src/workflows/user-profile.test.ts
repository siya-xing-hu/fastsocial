import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type { SocialPost, Workflow, TimelinePage } from '@fast-social/contracts';
import { openDatabase } from '../db/database.ts';
import { SettingsRepository } from '../repositories/settings-repository.ts';
import { AccountRepository } from '../repositories/account-repository.ts';
import { MonitorRepository } from '../repositories/monitor-repository.ts';
import { MonitorRunner } from '../monitor/monitor-runner.ts';
import { BatchMatcher, type BatchInput } from '../ai/batch-matcher.ts';
import type { TelegramNotifier } from '../telegram/telegram-notifier.ts';
import { WorkflowRepository } from './repository.ts';
import { WorkflowService } from './service.ts';
import { registerWorkflowRoutes, validateWorkflow } from './routes.ts';
import { XAdapter } from '../adapters/x/x-adapter.ts';
import type { XClient } from '../adapters/x/x-client.ts';
import { generateWorkflowReply } from './reply.ts';
import type { AIGateway } from '../ai/ai-gateway.ts';
import { OpenAICompatibleClient } from '../ai/openai-compatible-client.ts';

test('X adapter forwards the selected actor for profile reads and every timeline surface', async () => {
  const calls: unknown[][] = [];
  const account = { id: 'target', username: 'target', name: '', bio: '', fetchedAt: '' };
  const adapter = new XAdapter({
    async fetchAccount(...args: unknown[]) { calls.push(args); return account; },
    async fetchTimelinePage(...args: unknown[]) { calls.push(args); return { posts: [], nextCursor: null }; },
  } as unknown as XClient);
  await adapter.fetchAccount('target', 'selected-actor');
  await adapter.fetchTimelinePage(account, 'next', 'posts', 'selected-actor');
  await adapter.fetchTimelinePage(account, undefined, 'replies', 'selected-actor');
  assert.deepEqual(calls, [['target', 'selected-actor'], [account, 'next', 'posts', 'selected-actor'], [account, undefined, 'replies', 'selected-actor']]);
});

const post = (id: string, author = 'target'): SocialPost => ({ id, author, text: `Post ${id}`, platform: 'x', type: 'post', createdAt: '2026-01-01T00:00:00Z', url: `https://x.com/${author}/status/${id}` });
function harness(matcher?: BatchMatcher) {
  const db = openDatabase(':memory:'), settings = new SettingsRepository(db), repo = new WorkflowRepository(db), accounts = new AccountRepository(db);
  const actor = settings.configuration.saveAccount({ name: 'Actor', username: 'me', cookie: 'auth_token=a; ct0=b; twid=u%3D1' });
  const w = repo.save({ name: 'Target listener', source: 'user', usernames: ['target'], accountId: actor.id, condition: 'all new', intervalMinutes: 5, enabled: true, actions: [{ type: 'notify', content: '' }] });
  const pages: Array<{ cursor?: string; surface?: string }> = [];
  let pageOverride: ((cursor?: string, surface?: string) => TimelinePage) | undefined;
  const state = { posts: [post('1'), post('2')], fail: false, fetchFail: false, notifyFailure: '', profileReads: 0, bio: 'AI developer', beforeResult: (() => {}) as () => void | Promise<void> };
  const calls: BatchInput[] = [], cookies: (string | undefined)[] = [], sent: string[] = [], replyProfiles: string[] = [];
  const runner = new MonitorRunner({ accounts, monitors: new MonitorRepository(db), telegram: {} as TelegramNotifier,
    social: {
      async fetchRecentPosts() { throw new Error('Expected paginated timeline'); },
      async fetchAccount(username, cookie) { state.profileReads++; cookies.push(cookie); return { id: 'target-id', username, name: 'Target', bio: state.bio, fetchedAt: new Date().toISOString() }; },
      async fetchTimelinePage(_account, cursor, surface, cookie) {
        pages.push({ cursor, surface });
        if (pageOverride) return pageOverride(cursor, surface);
        if (state.fetchFail) throw new Error('读取帖子失败');
        cookies.push(cookie); assert.equal(surface, 'posts');
        const offset = Number(cursor ?? 0), ordered = [...state.posts].reverse();
        return { posts: ordered.slice(offset, offset + 20), nextCursor: offset + 20 < ordered.length ? String(offset + 20) : null };
      },
    },
    matcher: matcher ?? { async analyze(input: BatchInput) {
      calls.push(structuredClone(input)); if (state.fail) throw new Error('AI 输出被截断');
      await state.beforeResult();
      const latest = input.posts.at(-1);
      return { memory: latest ? { ...input.memory, recent: { text: `最近讨论 ${latest.id}`, evidenceIds: [latest.id], kind: 'explicit', updatedAt: new Date().toISOString() } } : null,
        decisions: input.rules.flatMap(rule => rule.postIds.map(postId => ({ postId, ruleId: rule.id, status: 'match', reason: '结合画像命中', evidenceIds: [postId] }))) };
    } } as unknown as BatchMatcher,
  });
  const serviceDeps: ConstructorParameters<typeof WorkflowService>[0] = { repository: repo, settings, userListener: runner,
    x: { identity: id => ({ actorId: '1', cookieId: id }), home: async () => [], follow: async () => ({ following: true, followedBy: false }), reply: async (_identity, id) => { sent.push('reply:' + id); return '999'; }, relationship: async () => ({ following: false, followedBy: false }) },
    timeline: async () => { throw new Error('Must use profile-aware batches'); }, userId: async () => 'target-id',
    evaluateBatch: async () => { throw new Error('Must use profile-aware batches'); }, generate: async () => '',
    generateReply: async (_id, _post, _action, profile) => { replyProfiles.push(profile?.memory.recent?.text ?? 'missing'); return 'Reply'; },
    notify: async (_text, p) => { if (p.id === state.notifyFailure) throw new Error('mock notification failure'); sent.push(p.id); },
  };
  const service = new WorkflowService(serviceDeps);
  return { db, repo, accounts, settings, actor, w, serviceDeps, state, calls, cookies, sent, runner, service, replyProfiles, pages, overridePages: (read: typeof pageOverride) => { pageOverride = read; } };
}

test('single-user runs never generate portraits and replies use only the manually saved portrait', async () => {
  const h = harness();
  try {
    await h.service.run(h.w.id);
    assert.deepEqual(h.sent, ['1', '2']); assert.deepEqual(h.calls[0]!.rules[0]!.postIds, ['1', '2']); h.sent.length = 0;
    assert.equal(h.repo.get(h.w.id)?.lastSeenPostId, '2'); assert.equal(h.accounts.profile('target-id'), null);
    assert.equal(h.calls.length, 1); assert.ok(h.calls.every(c => c.rules.length > 0));
    await h.service.rebuildProfile(h.w.id);
    const saved = h.accounts.profile('target-id');
    h.repo.save({ ...h.w, actions: [{ type: 'reply', mode: 'skill', elements: '' }, { type: 'notify', content: '' }] }, h.w.id);
    h.state.posts.push(post('3')); h.state.bio = 'A changed Profile'; await h.service.run(h.w.id);
    assert.equal(h.calls[2]!.memory.recent?.text, '最近讨论 2'); assert.equal(h.calls[2]!.includeBio, true);
    assert.deepEqual(h.sent, ['reply:3', '3']); assert.deepEqual(h.replyProfiles, ['最近讨论 2']);
    assert.deepEqual(h.accounts.profile('target-id'), saved); assert.equal(h.repo.get(h.w.id)?.lastSeenPostId, '3');
    assert.ok(h.cookies.every(cookie => cookie === h.actor.id));
    await h.service.run(h.w.id); assert.deepEqual(h.sent, ['reply:3', '3']); assert.equal(h.calls.length, 3);
    const view = h.service.profile(h.w.id); assert.deepEqual(view.evidence.map(p => p.id), ['1', '2']);
  } finally { await h.service.stop(); h.db.close(); }
});

test('single-user round resumes saved decisions and commits its original Post boundary only after the entire queue succeeds', async () => {
  const h = harness(); let service = h.service;
  try {
    h.state.posts.push(post('3')); h.state.notifyFailure = '2';
    await service.run(h.w.id);
    const original = service.runs()[0]!;
    assert.deepEqual([original.scanned, original.aiMatched, original.completed], [3, 3, 1]);
    assert.deepEqual(h.sent, ['1']); assert.equal(h.repo.get(h.w.id)?.lastSeenPostId, null);
    assert.deepEqual(h.repo.pending(h.w.id).map(r => r.post.id), ['3']);
    const pages = h.pages.length, ai = h.calls.length;
    h.state.posts.push(post('4')); h.state.notifyFailure = '';
    await service.stop(); service = new WorkflowService(h.serviceDeps);
    const plan = service.retryPlan(h.w.id);
    service.retryOnce(h.w.id, { configuration: plan.configuration, runId: plan.run?.id, revision: plan.revision,
      recordIds: plan.records.map(r => r.id), restoreEnabled: plan.restoreEnabled, confirmUncertain: true });
    await service.run(h.w.id);
    assert.deepEqual(h.sent, ['1', '2', '3']);
    assert.deepEqual([h.pages.length, h.calls.length], [pages, ai]);
    assert.equal(h.repo.get(h.w.id)?.lastSeenPostId, '3');
    assert.equal(h.accounts.status(h.w.id)?.phase, 'done'); assert.equal(h.accounts.status(h.w.id)?.error, null);
    assert.deepEqual([service.runs()[0]?.id, service.runs()[0]?.scanned, service.runs()[0]?.aiMatched, service.runs()[0]?.completed], [original.id, 3, 3, 3]);
    assert.equal(h.accounts.profile('target-id'), null);
    await service.run(h.w.id);
    assert.deepEqual(h.sent, ['1', '2', '3', '4']);
    assert.equal(h.repo.get(h.w.id)?.lastSeenPostId, '4');
  } finally { await service.stop(); h.db.close(); }
});
test('sparse AI hits mark the entire valid batch processed, while malformed output leaves it pending', async () => {
  for (const output of ['{"matches":[]}', 'one-hit', '{"matches":[']) {
    let calls = 0;
    const h = harness(new BatchMatcher({ async complete(_provider: unknown, messages: { content: string }[]) {
      calls++;
      if (output !== 'one-hit') return output;
      const input = JSON.parse(messages[1]!.content);
      return JSON.stringify({ matches: [{ postId: '2', ruleId: input.rules[0].id, reason: '命中', evidenceIds: ['2'] }] });
    } } as unknown as AIGateway));
    try {
      await h.service.run(h.w.id);
      const run = h.service.runs()[0]!;
      if (output === '{"matches":[') {
        assert.equal(run.status, 'failed'); assert.equal(h.repo.seen(h.w.id, '1'), false); assert.equal(h.repo.seen(h.w.id, '2'), false);
        assert.equal(h.repo.get(h.w.id)?.lastSeenPostId, null); assert.deepEqual(h.sent, []);
      } else {
        assert.equal(run.status, 'done'); assert.equal(run.checked, 2); assert.equal(run.scanned, 2);
        assert.equal(run.aiMatched, output === 'one-hit' ? 1 : 0); assert.deepEqual(h.sent, output === 'one-hit' ? ['2'] : []);
        assert.ok(h.repo.seen(h.w.id, '1')); assert.ok(h.repo.seen(h.w.id, '2'));
        await h.service.run(h.w.id); assert.equal(calls, 1);
      }
      assert.equal(h.accounts.profile('target-id'), null);
    } finally { await h.service.stop(); h.db.close(); }
  }
});
test('preview uses the profile but does not save learning, advance the cursor or execute actions', async () => {
  const h = harness();
  try {
    assert.equal((await h.service.preview(h.w)).length, 2);
    assert.equal(h.accounts.profile('target-id'), null); assert.equal(h.repo.get(h.w.id)?.lastSeenPostId, null);
    assert.deepEqual(h.sent, []); assert.deepEqual(h.accounts.posts('target-id'), []);
    await h.service.run(h.w.id); await h.service.rebuildProfile(h.w.id); h.sent.length = 0;
    const before = h.accounts.profile('target-id'); h.state.posts.push(post('3'));
    await h.service.preview(h.repo.get(h.w.id)!);
    assert.deepEqual(h.accounts.profile('target-id'), before); assert.equal(h.repo.get(h.w.id)?.lastSeenPostId, '2'); assert.deepEqual(h.sent, []);
  } finally { await h.service.stop(); h.db.close(); }
});
test('truncated AI results keep profile and cursor intact and retry the pending posts on the next run', async () => {
  const h = harness();
  try {
    await h.service.run(h.w.id); await h.service.rebuildProfile(h.w.id); h.sent.length = 0; const before = h.accounts.profile('target-id');
    h.state.posts.push(post('3')); h.state.fail = true; await h.service.run(h.w.id);
    assert.deepEqual(h.accounts.profile('target-id'), before); assert.equal(h.repo.get(h.w.id)?.lastSeenPostId, '2');
    assert.equal(h.repo.get(h.w.id)?.enabled, true); assert.deepEqual(h.sent, []);
    h.state.fail = false; await h.service.run(h.w.id); assert.deepEqual(h.sent, ['3']); assert.equal(h.repo.get(h.w.id)?.lastSeenPostId, '3');
  } finally { await h.service.stop(); h.db.close(); }
});
test('an empty first timeline does not turn the first later post into another historical baseline', async () => {
  const h = harness();
  try { h.state.posts = []; await h.service.run(h.w.id); h.state.posts.push(post('1')); await h.service.run(h.w.id); assert.deepEqual(h.sent, ['1']); }
  finally { await h.service.stop(); h.db.close(); }
});
test('initial Post history is capped at five pages and the next unchanged run reads only one page', async () => {
  const h = harness();
  try {
    h.repo.markSeen(h.w.id, '125');
    h.state.posts = Array.from({ length: 126 }, (_, i) => post(String(i + 1)));
    await h.service.run(h.w.id);
    assert.equal(h.pages.length, 5); assert.equal(h.sent.length, 99);
    assert.equal(h.pages.filter(p => p.surface === 'posts').length, 5);
    assert.equal(h.service.runs()[0]?.status, 'done');
    assert.ok(h.sent.includes('27')); assert.ok(!h.sent.includes('125'));
    assert.equal(h.repo.seen(h.w.id, '26'), false); // Outside this run's cap stays unprocessed.
    assert.ok(h.calls.every(c => c.posts.length <= 30));
    const aiCalls = h.calls.length;
    await h.service.run(h.w.id); assert.equal(h.pages.length, 6); assert.equal(h.calls.length, aiCalls);
    h.state.posts = [post('3'), post('200')]; await h.service.run(h.w.id);
    assert.equal(h.sent.at(-1), '200'); assert.ok(!h.sent.includes('3'));
    assert.equal(h.repo.get(h.w.id)?.lastSeenPostId, '200');
  } finally { await h.service.stop(); h.db.close(); }
});
test('empty and duplicate pages share the five-page budget without dropping older unseen posts', async () => {
  const h = harness();
  try {
    h.repo.markSeen(h.w.id, '100');
    h.overridePages((cursor, surface) => {
      if (surface === 'replies') return { posts: [post('100')], nextCursor: null };
      if (!cursor) return { posts: [post('100'), post('1')], nextCursor: 'next' };
      if (cursor === 'next') return { posts: [], nextCursor: 'empty' };
      if (cursor === 'empty') return { posts: [post('1'), post('2')], nextCursor: 'last' };
      return { posts: [post('3')], nextCursor: null };
    });
    await h.service.run(h.w.id);
    assert.equal(h.pages.length, 4); assert.deepEqual(h.sent, ['1', '2', '3']);
    assert.deepEqual(h.calls.flatMap(c => c.rules.flatMap(r => r.postIds)), ['1', '2', '3']);
  } finally { await h.service.stop(); h.db.close(); }
});
test('repeated pagination cursors fail without marking any fetched post processed', async () => {
  const h = harness();
  try {
    h.overridePages((_cursor, surface) => ({ posts: surface === 'posts' ? [post('1')] : [], nextCursor: surface === 'posts' ? 'same' : null }));
    await h.service.run(h.w.id);
    assert.equal(h.service.runs()[0]?.status, 'failed'); assert.match(h.service.runs()[0]!.error!, /游标重复/);
    assert.deepEqual(h.calls, []); assert.deepEqual(h.sent, []); assert.equal(h.repo.seen(h.w.id, '1'), false);
  } finally { await h.service.stop(); h.db.close(); }
});
test('Post boundary stops further pages but checks every newer post on the current page and ignores replies', async () => {
  for (const boundaryItem of ['100', '99']) {
    const h = harness();
    try {
      h.repo.write({ ...h.w, lastSeenPostId: '100' });
      h.overridePages((cursor, surface) => {
        assert.equal(cursor, undefined); assert.equal(surface, 'posts');
        return { posts: [post(boundaryItem), post('102'), { ...post('999'), type: 'reply' }, post('101')], nextCursor: 'must-not-read' };
      });
      await h.service.run(h.w.id);
      assert.deepEqual(h.sent, ['101', '102']); assert.equal(h.pages.length, 1);
      assert.equal(h.repo.get(h.w.id)?.lastSeenPostId, '102');
      assert.equal(h.repo.seen(h.w.id, '999'), false);
      assert.ok(h.calls.every(c => c.posts.every(p => p.type !== 'reply')));
      assert.equal(h.accounts.posts('target-id').some(p => p.id === '999'), false);
    } finally { await h.service.stop(); h.db.close(); }
  }
});
test('conversation context and reply-only or empty pages cannot falsely signal reaching the Post boundary', async () => {
  const h = harness();
  try {
    h.repo.write({ ...h.w, lastSeenPostId: '100' });
    h.overridePages(cursor => {
      if (!cursor) return { posts: [post('1'), post('105')], boundaryPostIds: ['105'], nextCursor: 'reply-page' };
      if (cursor === 'reply-page') return { posts: [{ ...post('2'), type: 'reply' }], boundaryPostIds: [], nextCursor: 'empty' };
      if (cursor === 'empty') return { posts: [], nextCursor: 'boundary' };
      return { posts: [post('104'), post('100'), post('103')], boundaryPostIds: ['104', '100', '103'], nextCursor: 'unneeded' };
    });
    await h.service.run(h.w.id);
    assert.deepEqual(h.sent, ['103', '104', '105']); assert.equal(h.pages.length, 4);
    assert.equal(h.repo.get(h.w.id)?.lastSeenPostId, '105');
  } finally { await h.service.stop(); h.db.close(); }
});
test('capped catch-up retains the old boundary and resumes pagination without losing the gap', async () => {
  const h = harness();
  try {
    h.repo.write({ ...h.w, lastSeenPostId: '1' });
    h.state.posts = Array.from({ length: 126 }, (_, i) => post(String(i + 1)));
    await h.service.run(h.w.id);
    assert.equal(h.pages.length, 5); assert.equal(h.sent.length, 100);
    assert.equal(h.repo.get(h.w.id)?.lastSeenPostId, '1');
    const pending = h.repo.get(h.w.id)?.postScan;
    assert.deepEqual(pending, { cursor: '100', newestPostId: '126', accountId: h.actor.id });
    // Repository reload preserves the continuation; ordinary saves also retain it.
    const reloaded = new WorkflowRepository(h.db);
    assert.deepEqual(reloaded.get(h.w.id)?.postScan, pending);
    reloaded.save({ ...reloaded.get(h.w.id)!, name: 'Renamed' }, h.w.id);
    h.state.fail = true; await h.service.run(h.w.id);
    assert.equal(h.repo.get(h.w.id)?.lastSeenPostId, '1'); assert.deepEqual(h.repo.get(h.w.id)?.postScan, pending);
    h.state.fail = false; const before = h.pages.length;
    await h.service.run(h.w.id);
    assert.equal(h.pages[before]?.cursor, '100');
    assert.equal(h.sent.length, 125); assert.equal(new Set(h.sent).size, 125); assert.ok(!h.sent.includes('1'));
    assert.equal(h.repo.get(h.w.id)?.lastSeenPostId, '126'); assert.equal(h.repo.get(h.w.id)?.postScan, null);
    const callCount = h.calls.length, pageCount = h.pages.length;
    await h.service.run(h.w.id);
    assert.equal(h.pages.length, pageCount + 1); assert.equal(h.calls.length, callCount);
  } finally { await h.service.stop(); h.db.close(); }
});
test('Post-only cursor migration excludes processed replies and unprocessed posts, preserving configuration and deduplication', () => {
  const h = harness();
  try {
    h.repo.write({ ...h.w, lastSeenPostId: '999' });
    h.accounts.savePosts('target-id', [post('50'), { ...post('999'), type: 'reply' }, post('1000')]);
    for (const id of ['50', '999']) h.repo.markSeen(h.w.id, id);
    h.db.prepare("DELETE FROM settings WHERE key='workflow_posts_only_cursor_v1'").run();
    const migrated = new WorkflowRepository(h.db);
    assert.equal(migrated.get(h.w.id)?.lastSeenPostId, '50');
    assert.equal(migrated.get(h.w.id)?.enabled, h.w.enabled);
    assert.deepEqual(migrated.get(h.w.id)?.actions, h.w.actions);
    assert.ok(migrated.seen(h.w.id, '50')); assert.ok(migrated.seen(h.w.id, '999'));
    migrated.write({ ...migrated.get(h.w.id)!, lastSeenPostId: '51', postScan: { cursor: 'next', newestPostId: '60', accountId: h.actor.id } });
    assert.equal(new WorkflowRepository(h.db).get(h.w.id)?.lastSeenPostId, '51');
    migrated.save({ ...migrated.get(h.w.id)!, usernames: ['another'] }, h.w.id);
    assert.equal(migrated.get(h.w.id)?.lastSeenPostId, null); assert.equal(migrated.get(h.w.id)?.postScan, null);
  } finally { h.db.close(); }
});
test('single-user workflows expose each real AI judgment batch', async () => {
  const h = harness();
  try {
    h.state.beforeResult = () => {
      assert.equal(h.service.runs()[0]?.phase, 'analyze');
      assert.deepEqual([h.service.runs()[0]?.scanned, h.service.runs()[0]?.aiMatched], [2, 0]);
      assert.deepEqual(h.service.runs()[0]?.batch, { index: 1, total: 2, checked: 0, matched: 0, completed: 0 });
    };
    await h.service.run(h.w.id);
    h.state.posts = Array.from({ length: 37 }, (_, i) => post(String(i + 1)));
    const observed: unknown[] = [];
    h.state.beforeResult = () => {
      const run = h.service.runs()[0]!;
      assert.equal(run.scanned, 37);
      observed.push([run.phase, run.batch?.index, run.batch?.total, run.batch?.checked, run.checked, run.matched, run.completed]);
    };
    await h.service.run(h.w.id);
    assert.deepEqual(observed, [['analyze', 1, 30, 0, 0, 0, 0], ['analyze', 2, 5, 0, 30, 30, 0]]);
    const run = h.service.runs()[0]!;
    assert.deepEqual([run.checked, run.matched, run.completed], [35, 35, 35]);
    assert.deepEqual([run.scanned, run.aiMatched], [37, 35]);
    assert.deepEqual(run.batch, { index: 2, total: 5, checked: 5, matched: 5, completed: 5 });
  } finally { await h.service.stop(); h.db.close(); }
});
test('editing a workflow in flight commits neither its old profile result nor its cursor or actions', async () => {
  const h = harness();
  try {
    h.state.beforeResult = () => { h.repo.save({ ...h.w, condition: 'changed' }, h.w.id); };
    await h.service.run(h.w.id); assert.equal(h.accounts.profile('target-id'), null); assert.equal(h.repo.get(h.w.id)?.lastSeenPostId, null); assert.deepEqual(h.sent, []);
  } finally { await h.service.stop(); h.db.close(); }
});
test('workflow profile routes expose evidence and support manual correction and clearing', async () => {
  const h = harness(), app = Fastify(); registerWorkflowRoutes(app, h.repo, h.service, h.settings);
  try {
    await h.service.run(h.w.id); await h.service.rebuildProfile(h.w.id); h.sent.length = 0;
    assert.equal((await app.inject(`/api/workflows/${h.w.id}/profile`)).json().data.profile.account.username, 'target');
    const saved = await app.inject({ method: 'PUT', url: `/api/workflows/${h.w.id}/profile`, payload: { text: '主题：只关注实际发布的开发工具' } });
    assert.equal(saved.statusCode, 200); assert.equal(saved.json().data.profile.memory.topics.kind, 'manual');
    h.state.posts.push(post('3')); await h.service.run(h.w.id); assert.equal(h.calls.at(-1)?.memory.topics?.kind, 'manual');
    await app.inject({ method: 'PUT', url: `/api/workflows/${h.w.id}/profile`, payload: { text: '' } });
    assert.deepEqual(h.accounts.profile('target-id')?.memory, {});
  } finally { await h.service.stop(); await app.close(); h.db.close(); }
});
test('manual rebuild uses a fresh Profile and latest 10 posts without consuming pending workflow posts', async () => {
  const h = harness();
  try {
    await h.service.run(h.w.id); await h.service.rebuildProfile(h.w.id); h.sent.length = 0;
    await h.service.editProfile(h.w.id, '主题：旧的人工画像');
    const before = h.accounts.profile('target-id')!;
    const records = h.repo.records(h.w.id);
    const workflow = h.repo.get(h.w.id), status = h.accounts.status(h.w.id), decisions = h.accounts.decisions(h.w.id);
    h.state.bio = 'Now building open source tools';
    h.state.posts = Array.from({ length: 30 }, (_, i) => post(String(i + 1)));
    const pageCount = h.pages.length, callCount = h.calls.length;
    const view = await h.service.rebuildProfile(h.w.id);
    assert.deepEqual(h.pages.slice(pageCount), [{ cursor: undefined, surface: 'posts' }]);
    assert.equal(h.calls.length, callCount + 1);
    const input = h.calls.at(-1)!;
    assert.equal(h.state.profileReads, 3); assert.equal(input.account.bio, h.state.bio); assert.equal(input.includeBio, true);
    assert.deepEqual(input.memory, {}); assert.deepEqual(input.context, []); assert.deepEqual(input.rules, []);
    assert.deepEqual(input.posts.map(p => p.id), Array.from({ length: 10 }, (_, i) => String(i + 21)));
    assert.equal(view.profile?.version, before.version + 1); assert.equal(view.profile?.memory.topics, undefined);
    assert.equal(view.profile?.memory.recent?.text, '最近讨论 30'); assert.deepEqual(view.evidence.map(p => p.id), input.posts.map(p => p.id));
    assert.deepEqual(h.repo.get(h.w.id), workflow); assert.deepEqual(h.accounts.status(h.w.id), status);
    assert.deepEqual(h.accounts.decisions(h.w.id), decisions); assert.deepEqual(h.repo.records(h.w.id), records); assert.deepEqual(h.sent, []);
    assert.equal(h.repo.seen(h.w.id, '30'), false); assert.ok(h.cookies.every(cookie => cookie === h.actor.id));
    h.state.posts.push(post('31')); await h.service.run(h.w.id);
    assert.equal(h.calls.at(-1)?.memory.recent?.text, '最近讨论 30');
    assert.deepEqual(h.sent, Array.from({ length: 29 }, (_, i) => String(i + 3)));
    assert.equal(h.repo.get(h.w.id)?.lastSeenPostId, '31'); assert.equal(h.accounts.profile('target-id')?.memory.recent?.text, '最近讨论 30');
  } finally { await h.service.stop(); h.db.close(); }
});
test('long multiline manual portraits persist verbatim with their evidence and without external requests', async () => {
  const h = harness(), app = Fastify(); registerWorkflowRoutes(app, h.repo, h.service, h.settings);
  try {
    const initial = await h.service.rebuildProfile(h.w.id);
    const calls = h.calls.length, pages = h.pages.length, reads = h.state.profileReads;
    const workflow = h.repo.get(h.w.id);
    const text = '主题：' + Array.from({length: 8}, (_, i) => `第 ${i} 段：${'产品开发与公开经验。'.repeat(10)}`).join('\n\n');
    const result = await app.inject({method: 'PUT', url: `/api/workflows/${h.w.id}/profile`, payload: {text}});
    assert.equal(result.statusCode, 200);
    assert.equal(result.json().data.profile.portraitText, text);
    assert.equal(result.json().data.profile.memory.topics.text, text.slice(3));
    assert.deepEqual(result.json().data.evidence, initial.evidence);
    assert.equal(new AccountRepository(h.db).profile('target-id')?.portraitText, text);
    const cleared = await h.service.editProfile(h.w.id, '');
    assert.deepEqual(cleared.profile?.memory, {}); assert.deepEqual(cleared.evidence, initial.evidence);
    assert.deepEqual([h.calls.length, h.pages.length, h.state.profileReads], [calls, pages, reads]);
    assert.deepEqual(h.repo.get(h.w.id), workflow);
    const rebuilt = await h.service.rebuildProfile(h.w.id);
    assert.equal(rebuilt.profile?.portraitText, undefined);
    assert.deepEqual(rebuilt.profile?.evidenceIds, ['1', '2']);
  } finally { await h.service.stop(); await app.close(); h.db.close(); }
});
test('portrait refresh route can initialize a paused listener without actions, while rejecting missing or home workflows', async () => {
  const h = harness(), app = Fastify(); registerWorkflowRoutes(app, h.repo, h.service, h.settings);
  try {
    h.repo.save({ ...h.w, enabled: false, actions: [] }, h.w.id);
    const before = h.repo.get(h.w.id);
    const result = await app.inject({ method: 'POST', url: `/api/workflows/${h.w.id}/profile/refresh` });
    assert.equal(result.statusCode, 200); assert.equal(result.json().data.profile.account.username, 'target');
    assert.equal(result.json().data.profile.version, 1); assert.deepEqual(h.repo.get(h.w.id), before);
    assert.deepEqual(h.sent, []); assert.equal(h.accounts.status(h.w.id), null);
    assert.equal((await app.inject({ method: 'POST', url: '/api/workflows/missing/profile/refresh' })).statusCode, 404);
    h.repo.save({ ...h.w, source: 'home', usernames: [] }, h.w.id);
    const invalid = await app.inject({ method: 'POST', url: `/api/workflows/${h.w.id}/profile/refresh` });
    assert.match(invalid.json().message, /仅指定用户监听/); assert.equal(h.calls.length, 1);
  } finally { await h.service.stop(); await app.close(); h.db.close(); }
});
test('failed portrait rebuilds preserve the saved portrait, evidence and workflow progress', async () => {
  const h = harness();
  try {
    await h.service.run(h.w.id); await h.service.rebuildProfile(h.w.id); h.sent.length = 0;
    const before = h.accounts.profile('target-id'), evidence = h.accounts.posts('target-id'), workflow = h.repo.get(h.w.id);
    h.state.posts.push(post('3')); h.state.bio = 'New bio';
    for (const stage of ['fetchFail', 'fail'] as const) {
      h.state[stage] = true;
      await assert.rejects(h.service.rebuildProfile(h.w.id), stage === 'fail' ? /AI 输出被截断/ : /读取帖子失败/);
      h.state[stage] = false;
      assert.deepEqual(h.accounts.profile('target-id'), before); assert.deepEqual(h.accounts.posts('target-id'), evidence);
      assert.deepEqual(h.repo.get(h.w.id), workflow); assert.deepEqual(h.sent, []);
    }
    await h.service.rebuildProfile(h.w.id); assert.equal(h.accounts.profile('target-id')?.memory.recent?.text, '最近讨论 3');
  } finally { await h.service.stop(); h.db.close(); }
});
test('portrait refresh saves grouped AI facts and full evidence without consuming pending workflow posts', async () => {
  let portrait: unknown = { background: { text: '旧画像', evidenceIds: ['1'], kind: 'explicit' } }, requests = 0;
  const h = harness(new BatchMatcher({ async complete(_provider: unknown, messages: { content: string }[]) {
    if (JSON.parse(messages[1]!.content).rules.length) return '{"matches":[]}';
    requests++; return JSON.stringify({ memory: portrait });
  } } as unknown as AIGateway));
  try {
    await h.service.run(h.w.id);
    const initial = await h.service.rebuildProfile(h.w.id);
    const workflow = h.repo.get(h.w.id), status = h.accounts.status(h.w.id), decisions = h.accounts.decisions(h.w.id), records = h.repo.records(h.w.id);
    h.state.posts.push(post('3')); h.state.bio = 'Now building open source tools';
    portrait = {
      background: {
        builder: { text: '开发开源工具', evidenceIds: ['1'], kind: 'explicit' },
        identity: { text: '自述为独立开发者', evidenceIds: ['unknown'], kind: 'explicit' },
        career: { text: '近期开始分享产品实践', evidenceIds: ['3'], kind: 'inferred' },
        metadata: { evidenceIds: ['2'], kind: 'explicit', confidence: 0.9 },
      },
      topics: {
        interests: { text: '关注 AI 辅助编程', evidenceIds: ['2'], kind: 'explicit' },
        focus: { text: '讨论实际开发中的效率', evidenceIds: ['3'], kind: 'explicit' },
      },
      language: { style: { text: '使用简洁中文说明经验', evidenceIds: ['2'], kind: 'inferred' } },
      recent: {
        updates: { text: '发布工具更新', evidenceIds: ['3'], kind: 'explicit' },
        activity: { text: '交流开发过程', evidenceIds: ['3'], kind: 'explicit' },
      },
    };
    const pages = h.pages.length, reads = h.state.profileReads;
    const view = await h.service.rebuildProfile(h.w.id);
    assert.equal(requests, 2);
    assert.deepEqual(h.pages.slice(pages), [{ cursor: undefined, surface: 'posts' }]); assert.equal(h.state.profileReads, reads + 1);
    assert.equal(view.profile?.version, initial.profile!.version + 1);
    assert.equal(view.profile?.memory.background?.text, '开发开源工具\n自述为独立开发者\n近期开始分享产品实践');
    assert.deepEqual(view.profile?.memory.background?.evidenceIds, ['1', '3']);
    assert.equal(view.profile?.memory.topics?.text, '关注 AI 辅助编程\n讨论实际开发中的效率');
    assert.equal(view.profile?.memory.language?.text, '使用简洁中文说明经验');
    assert.equal(view.profile?.memory.recent?.text, '发布工具更新\n交流开发过程');
    assert.equal(view.profile?.account.bio, h.state.bio);
    assert.deepEqual(view.profile?.evidenceIds, ['1', '2', '3']); assert.deepEqual(view.evidence.map(p => p.id), ['1', '2', '3']);
    assert.deepEqual(new AccountRepository(h.db).profile('target-id'), view.profile);
    assert.deepEqual(h.repo.get(h.w.id), workflow); assert.deepEqual(h.accounts.status(h.w.id), status);
    assert.deepEqual(h.accounts.decisions(h.w.id), decisions); assert.deepEqual(h.repo.records(h.w.id), records);
    assert.equal(h.repo.seen(h.w.id, '3'), false); assert.deepEqual(h.sent, []);
  } finally { await h.service.stop(); h.db.close(); }
});
test('empty and metadata-only portraits fail once and preserve the saved portrait, evidence and workflow progress', async () => {
  let portrait: unknown = { background: { text: '旧画像', evidenceIds: ['1'], kind: 'explicit' } }, requests = 0;
  const h = harness(new BatchMatcher({ async complete(_provider: unknown, messages: { content: string }[]) {
    if (JSON.parse(messages[1]!.content).rules.length) return '{"matches":[]}';
    requests++; return JSON.stringify({ memory: portrait });
  } } as unknown as AIGateway));
  try {
    await h.service.run(h.w.id); await h.service.rebuildProfile(h.w.id);
    await h.service.editProfile(h.w.id, '背景：保留人工修正\n主题：旧主题');
    const before = h.accounts.profile('target-id'), evidence = h.service.profile(h.w.id).evidence, posts = h.accounts.posts('target-id');
    const workflow = h.repo.get(h.w.id), status = h.accounts.status(h.w.id), decisions = h.accounts.decisions(h.w.id), records = h.repo.records(h.w.id);
    h.state.posts.push(post('3')); h.state.bio = 'Changed Profile';
    for (const invalid of [{}, {
      background: { builder: { evidenceIds: ['3'], kind: 'explicit', confidence: 0.9 }, metadata: { source: 'Profile', updatedAt: '2026-01-01' } },
      topics: { evidenceIds: ['3'], kind: 'inferred' },
      language: { style: { evidenceIds: ['3'], kind: 'explicit' } },
      recent: { activity: { evidenceIds: ['3'], kind: 'explicit' } },
    }]) {
      portrait = invalid;
      const previousRequests = requests, pages = h.pages.length, reads = h.state.profileReads;
      await assert.rejects(h.service.rebuildProfile(h.w.id), /AI 未返回可读取的画像正文/);
      assert.equal(requests, previousRequests + 1);
      assert.deepEqual(h.pages.slice(pages), [{ cursor: undefined, surface: 'posts' }]); assert.equal(h.state.profileReads, reads + 1);
      assert.deepEqual(h.accounts.profile('target-id'), before); assert.deepEqual(h.service.profile(h.w.id).evidence, evidence);
      assert.deepEqual(h.accounts.posts('target-id'), posts);
      assert.deepEqual(h.repo.get(h.w.id), workflow); assert.deepEqual(h.accounts.status(h.w.id), status);
      assert.deepEqual(h.accounts.decisions(h.w.id), decisions); assert.deepEqual(h.repo.records(h.w.id), records);
      assert.equal(h.repo.seen(h.w.id, '3'), false); assert.deepEqual(h.sent, []);
    }
  } finally { await h.service.stop(); h.db.close(); }
});
test('repeated refreshes share one operation and a concurrent task uses its committed portrait', async () => {
  const h = harness(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  try {
    await h.service.run(h.w.id); h.sent.length = 0; h.state.posts.push(post('3'));
    h.state.beforeResult = async () => { entered.resolve(); await release.promise; };
    const first = h.service.rebuildProfile(h.w.id), second = h.service.rebuildProfile(h.w.id);
    assert.equal(first, second); await entered.promise;
    const run = h.service.run(h.w.id);
    h.state.beforeResult = () => {}; release.resolve(); await Promise.all([first, run]);
    assert.equal(h.calls.length, 3); assert.deepEqual(h.calls[1]?.memory, {});
    assert.equal(h.calls[2]?.memory.recent?.text, '最近讨论 3'); assert.deepEqual(h.sent, ['3']);
  } finally { release.resolve(); await h.service.stop(); h.db.close(); }
});
test('changing the listening user during a rebuild prevents stale profile and evidence from being committed', async () => {
  const h = harness();
  try {
    await h.service.run(h.w.id); await h.service.rebuildProfile(h.w.id); h.sent.length = 0;
    const before = h.accounts.profile('target-id'), evidence = h.accounts.posts('target-id');
    h.state.posts.push(post('3'));
    h.state.beforeResult = () => { h.repo.save({ ...h.w, usernames: ['changed'] }, h.w.id); };
    await assert.rejects(h.service.rebuildProfile(h.w.id), /画像未更新/);
    assert.deepEqual(h.accounts.profile('target-id'), before); assert.deepEqual(h.accounts.posts('target-id'), evidence);
    assert.deepEqual(h.sent, []);
  } finally { await h.service.stop(); h.db.close(); }
});
test('reply generation uses the target profile as source material while retaining the speaking account identity and language', async () => {
  const h = harness();
  try {
    await h.service.run(h.w.id); await h.service.rebuildProfile(h.w.id); h.sent.length = 0;
    const assistant = { async chat(input: any, options: any) {
      assert.equal(input.context.account.actorId, '1'); assert.equal(input.targetLanguage, 'zh-CN'); assert.equal(options.fixedProfileLanguage, true);
      assert.match(input.input, /被监听用户 @target/); assert.match(input.input, /最近讨论 2/); assert.match(input.input, /不是当前发言账号的身份/);
      return { content: '一条回复' };
    } } as unknown as Parameters<typeof generateWorkflowReply>[0];
    assert.equal(await generateWorkflowReply(assistant, h.settings.configuration, h.actor.id, post('3'), { type: 'reply', mode: 'skill', elements: '具体一点' }, h.accounts.profile('target-id')), '一条回复');
  } finally { await h.service.stop(); h.db.close(); }
});
test('multiple-user inputs are rejected and existing grouped workflows split without losing progress or records', () => {
  const h = harness();
  try {
    assert.throws(() => validateWorkflow({ ...h.w, source: 'users' }, h.settings), /监听来源/);
    assert.throws(() => validateWorkflow({ ...h.w, usernames: ['one', 'two'] }, h.settings), /监听用户/);
    h.repo.write({ ...h.w, source: 'users', usernames: ['one', 'two'], lastSeenPostId: '10' } as unknown as Workflow);
    h.repo.markSeen(h.w.id, '10');
    h.repo.record({ id: 'r', workflowId: h.w.id, post: post('10', 'two'), reason: 'matched', status: 'done', actions: [{ type: 'notify', status: 'done' }], createdAt: h.w.createdAt });
    h.db.prepare("DELETE FROM settings WHERE key='workflow_single_user_profiles_v1'").run();
    const repo = new WorkflowRepository(h.db), entries = repo.list();
    assert.equal(entries.length, 2); assert.ok(entries.every(w => w.source === 'user' && w.usernames.length === 1 && w.enabled && w.lastSeenPostId === '10'));
    const second = entries.find(w => w.usernames[0] === 'two')!; assert.ok(repo.seen(second.id, '10')); assert.equal(repo.records(second.id)[0]?.id, 'r');
    assert.equal(new WorkflowRepository(h.db).list().length, 2);
    repo.save({ ...second, usernames: ['changed'] }, second.id); assert.equal(repo.get(second.id)?.lastSeenPostId, null);
  } finally { h.db.close(); }
});


test('streamed portrait refresh commits only completed content and keeps old evidence after an interrupted response', async () => {
  let broken = false, requests = 0;
  const client = new OpenAICompatibleClient(async (_url, init) => {
    requests++; const body = JSON.parse(String(init?.body)); assert.equal(body.stream, true);
    const content = JSON.stringify({memory: {background: {text: '画像版本 ' + requests, evidenceIds: ['bio', 'made-up']}}});
    return new Response(`data: ${JSON.stringify({choices: [{delta: {content}}]})}\n\n` + (broken ? '' : 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'), {headers: {'content-type': 'text/event-stream'}});
  });
  const h = harness(new BatchMatcher({complete: (_provider, messages, maxOutputTokens) => client.complete({
    service: {id: 'fixture', name: 'Fixture', endpoint: 'https://fixture.invalid/chat', apiKey: 'test', enabled: true, models: [{name: 'model'}]},
    model: {name: 'model'}, messages, maxOutputTokens,
  })} as AIGateway));
  try {
    const first = await h.service.rebuildProfile(h.w.id); assert.equal(first.profile?.memory.background?.text, '画像版本 1');
    assert.deepEqual(first.profile?.memory.background?.evidenceIds, []);
    assert.deepEqual(first.evidence.map(p => p.id), ['1', '2']);
    h.state.posts.push(post('3')); const workflow = h.repo.get(h.w.id);
    broken = true; await assert.rejects(h.service.rebuildProfile(h.w.id), /未完整结束/);
    assert.deepEqual(h.accounts.profile('target-id'), first.profile);
    assert.deepEqual(h.service.profile(h.w.id).evidence, first.evidence); assert.deepEqual(h.repo.get(h.w.id), workflow);
    assert.deepEqual(h.sent, []); assert.equal(requests, 2);
    broken = false; const next = await h.service.rebuildProfile(h.w.id);
    assert.equal(next.profile?.memory.background?.text, '画像版本 3'); assert.deepEqual(next.evidence.map(p => p.id), ['1', '2', '3']);
  } finally { await h.service.stop(); h.db.close(); }
});
