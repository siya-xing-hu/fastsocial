import test from 'node:test';
import assert from 'node:assert/strict';
import type { OutreachRecord } from '@fast-social/contracts';
import { openDatabase } from '../db/database.ts';
import { OutreachRepository, DEFAULT_OUTREACH_CONFIG } from './repository.ts';
import { OutreachRunner } from './runner.ts';
import type { OutreachAdapter, OutreachClassifier, OutreachPost } from './types.ts';
import { OutreachXError } from './x-client.ts';

const DAY = 86400000;
function harness() {
  let now = Date.parse('2026-09-29T01:00:00Z');
  const db = openDatabase(':memory:');
  const root = new OutreachRepository(db);
  root.saveConfig({ ...DEFAULT_OUTREACH_CONFIG, id: 'account', name: 'Account', enabled: true, cookieId: 'cookie', actorId: '1' });
  const repository = root.scope('account');
  const calls: string[] = [];
  const posts: OutreachPost[] = [];
  const social: OutreachAdapter = {
    identity: cookieId => ({ cookieId, actorId: '1' }),
    home: async () => { calls.push('home'); return posts; },
    follow: async (_, id) => { calls.push(`follow:${id}`); return { following: true, followedBy: false }; },
    reply: async (_, postId) => { calls.push(`reply:${postId}`); return '999'; },
    relationship: async (_, id) => { calls.push(`check:${id}`); return { following: true, followedBy: true }; },
  };
  const classifier: OutreachClassifier = { classify: async items => items.map(({ post }) => ({ postId: post.id, status: 'match', reason: '明确邀请互关' })) };
  const makeRunner = () => new OutreachRunner(repository, social, classifier, () => now);
  const runner = makeRunner();
  const record = (id: string, patch: Partial<OutreachRecord> = {}): OutreachRecord => ({
    id: `1:${id}`, actorId: '1', userId: id, username: `user${id}`, name: 'User', postId: `10${id}`, postText: '互关', postCreatedAt: new Date(now).toISOString(),
    reason: '邀请互关', replyText: '已关注，互相联系～', stage: 'done', following: true, followedBy: false,
    createdAt: new Date(now).toISOString(), followedAt: new Date(now).toISOString(), followAttemptAt: new Date(now).toISOString(), repliedAt: null, replyId: null,
    autoCheckAttemptAt: null, lastCheckAttemptAt: null, lastCheckedAt: null, checkState: 'idle', actionError: null, checkError: null, ...patch,
  });
  return { db, repository, social, calls, posts, classifier, runner, makeRunner, record, now: () => now, advance: (ms: number) => { now += ms; }, close: () => db.close() };
}

test('outreach discovers once, follows before replying, persists pacing and deduplicates authors', async () => {
  const h = harness();
  try {
    h.posts.push(...['20', '21'].map(id => ({ userId: '2', name: 'User', following: false, followedBy: false, post: { id, author: 'user2', text: '来互关', platform: 'x' as const, type: 'post' as const, createdAt: new Date(h.now()).toISOString(), url: `https://x.com/user2/status/${id}` } })));
    await h.runner.tick();
    assert.deepEqual(h.calls, ['home']);
    assert.equal(h.repository.all().length, 1);
    await h.runner.tick();
    assert.deepEqual(h.calls, ['home']);
    h.advance(60000);
    await h.runner.tick();
    assert.equal(h.repository.get('1:2')?.stage, 'pending_reply');
    const restarted = h.makeRunner();
    await restarted.tick();
    assert.deepEqual(h.calls, ['home', 'follow:2']);
    h.advance(60000);
    await restarted.tick();
    assert.deepEqual(h.calls, ['home', 'follow:2', 'reply:20']);
    assert.equal(h.repository.get('1:2')?.stage, 'done');
    h.advance(3600000);
    await restarted.tick();
    assert.equal(h.repository.all().length, 1);
    assert.equal(h.calls.filter(call => call.startsWith('follow:')).length, 1);
  } finally { h.close(); }
});

test('legacy outreach never replies when the tracked follow is skipped or subsequently opted out', async () => {
  const h = harness();
  try {
    h.repository.add(h.record('2', { stage: 'pending_follow', following: false, followedAt: null }));
    h.social.follow = async () => ({ following: true, followedBy: false, created: false, skipReason: '已经关注' });
    await h.runner.tick();
    assert.equal(h.repository.get('1:2')?.stage, 'skipped'); assert.equal(h.repository.get('1:2')?.followedAt, null);
    h.repository.add(h.record('3', { stage: 'pending_reply' }));
    h.social.followSkipReason = () => '已取消关注';
    h.advance(60000); await h.runner.tick();
    assert.equal(h.repository.get('1:3')?.stage, 'skipped'); assert.ok(!h.calls.some(call => call.startsWith('reply:')));
  } finally { h.close(); }
});

test('automatic relationship check waits 24 hours and runs only once across restarts', async () => {
  const h = harness();
  try {
    h.repository.add(h.record('2'));
    h.repository.patchState({ lastFetchedAt: new Date(h.now()).toISOString() });
    h.social.relationship = async () => { h.calls.push('check'); return { following: true, followedBy: false }; };
    h.advance(DAY - 1);
    await h.runner.tick();
    assert.equal(h.calls.includes('check'), false);
    h.advance(60000);
    await h.runner.tick();
    assert.ok(h.repository.get('1:2')?.autoCheckAttemptAt);
    const restarted = h.makeRunner();
    h.advance(DAY * 3);
    await restarted.tick();
    assert.equal(h.calls.filter(call => call === 'check').length, 1);
    assert.equal(h.repository.get('1:2')?.followedBy, false);
  } finally { h.close(); }
});

test('a failed one-day check preserves relationship and is not automatically retried', async () => {
  const h = harness();
  try {
    h.repository.add(h.record('2', { followedAt: new Date(h.now() - DAY).toISOString() }));
    h.social.relationship = async () => { h.calls.push('check'); throw new Error('网络错误'); };
    await h.runner.tick();
    const row = h.repository.get('1:2')!;
    assert.ok(row.autoCheckAttemptAt);
    assert.equal(row.followedBy, false);
    assert.equal(row.checkState, 'error');
    assert.equal(row.lastCheckedAt, null);
    h.runner.resume(); h.advance(DAY);
    await h.makeRunner().tick();
    assert.equal(h.calls.filter(call => call === 'check').length, 1);
  } finally { h.close(); }
});

test('manual batch checks only eligible users serially, saves every result, skips mutual and unfollowed users', async () => {
  const h = harness();
  try {
    h.repository.saveConfig({ ...h.repository.config(), enabled: false });
    h.repository.add(h.record('2'));
    h.repository.add(h.record('3', { followedBy: true }));
    h.repository.add(h.record('4', { following: false }));
    h.repository.add(h.record('5', { actorId: '9' }));
    h.repository.add(h.record('6', { lastCheckAttemptAt: new Date(h.now()).toISOString() }));
    h.repository.add(h.record('7', { followedBy: null }));
    h.runner.startChecks(); h.runner.startChecks();
    assert.equal(h.repository.state().checkJob?.ids.length, 2);
    await h.runner.tick();
    assert.deepEqual(h.calls, ['check:2']);
    assert.equal(h.repository.get('1:2')?.followedBy, true);
    assert.equal(h.repository.get('1:7')?.followedBy, null);
    await h.runner.tick();
    assert.equal(h.calls.length, 1);
    h.advance(60000); await h.runner.tick();
    assert.deepEqual(h.calls, ['check:2', 'check:7']);
    assert.equal(h.repository.state().checkJob?.status, 'done');
    h.runner.startChecks();
    assert.equal(h.repository.state().checkJob?.ids.length, 0);
  } finally { h.close(); }
});

test('manual checking after the one-day deadline satisfies the one-time automatic check', async () => {
  const h = harness();
  try {
    h.repository.add(h.record('2', { followedAt: new Date(h.now() - DAY).toISOString() }));
    h.runner.startChecks();
    await h.runner.tick();
    assert.ok(h.repository.get('1:2')?.autoCheckAttemptAt);
    assert.deepEqual(h.calls, ['check:2']);
  } finally { h.close(); }
});

test('uncertain follow or reply results are never automatically resent', async () => {
  for (const phase of ['follow', 'reply'] as const) {
    const h = harness();
    try {
      h.repository.add(h.record('2', { stage: phase === 'follow' ? 'pending_follow' : 'pending_reply', followAttemptAt: null }));
      h.social[phase] = async () => { h.calls.push(phase); throw new Error('timeout'); };
      await h.runner.tick();
      assert.equal(h.repository.get('1:2')?.stage, 'uncertain');
      h.advance(60000); h.runner.resume(); await h.runner.tick();
      assert.equal(h.calls.filter(call => call === phase).length, 1);
      assert.equal(h.calls.includes('reply:102'), false);
    } finally { h.close(); }
  }
});

test('pending follow requests do not cause a reply, daily limit counts attempts and interrupted writes become uncertain', async () => {
  const h = harness();
  try {
    h.repository.saveConfig({ ...h.repository.config(), dailyLimit: 1 });
    h.repository.add(h.record('2', { stage: 'pending_follow', followAttemptAt: null }));
    h.repository.add(h.record('3', { stage: 'pending_follow', followAttemptAt: null }));
    h.social.follow = async () => { h.calls.push('follow'); return { following: false, followedBy: false }; };
    await h.runner.tick(); h.advance(60000); await h.runner.tick();
    assert.deepEqual(h.calls, ['follow']);
    assert.equal(h.repository.get('1:2')?.stage, 'skipped');
    h.repository.patch('1:3', { stage: 'replying' });
    h.makeRunner();
    assert.equal(h.repository.get('1:3')?.stage, 'uncertain');
  } finally { h.close(); }
});

test('concurrent ticks share the active request and stopping a batch prevents the next request', async () => {
  const h = harness();
  try {
    h.repository.saveConfig({ ...h.repository.config(), enabled: false });
    h.repository.add(h.record('2')); h.repository.add(h.record('3'));
    let finish!: () => void;
    h.social.relationship = async () => { h.calls.push('check'); await new Promise<void>(resolve => { finish = resolve; }); return { following: true, followedBy: false }; };
    h.runner.startChecks();
    const first = h.runner.tick(); const second = h.runner.tick();
    assert.equal(first, second);
    h.runner.stopChecks(); finish(); await first;
    h.advance(60000); await h.runner.tick();
    assert.deepEqual(h.calls, ['check']);
    assert.equal(h.repository.state().checkJob?.status, 'stopped');
    assert.ok(h.repository.get('1:2')?.lastCheckedAt);
  } finally { h.close(); }
});

test('rate limit pause survives resume and restart without shortening Retry-After', async () => {
  const h = harness();
  try {
    h.social.home = async () => { h.calls.push('home'); throw new OutreachXError('限流', 7200); };
    await h.runner.tick();
    assert.equal(h.repository.state().nextRequestAt, new Date(h.now() + 7200000).toISOString());
    h.runner.resume(); h.advance(3600000); await h.makeRunner().tick();
    assert.deepEqual(h.calls, ['home']);
  } finally { h.close(); }
});

test('configuration changes during analysis discard stale candidates, and cookie identity changes block execution', async () => {
  const h = harness();
  try {
    h.posts.push({ userId: '2', name: 'User', following: false, followedBy: false, post: { id: '20', platform: 'x', author: 'user2', text: '互关', type: 'post', createdAt: new Date(h.now()).toISOString(), url: 'https://x.com/user2/status/20' } });
    h.classifier.classify = async () => { h.repository.saveConfig({ ...h.repository.config(), enabled: false }); return [{ postId: '20', status: 'match', reason: '互关' }]; };
    await h.runner.tick();
    assert.equal(h.repository.all().length, 0);
    h.repository.saveConfig({ ...h.repository.config(), enabled: true });
    h.social.identity = cookieId => ({ cookieId, actorId: '9' });
    h.advance(3600000); await h.runner.tick();
    assert.equal(h.calls.length, 1);
    assert.match(h.repository.state().pauseReason!, /账号已改变/);
  } finally { h.close(); }
});

test('automation can be disabled even after its Cookie expires', () => {
  const h = harness();
  try {
    h.social.identity = () => { throw new Error('Cookie 已失效'); };
    const { actorId, id: _id, ...config } = h.repository.config();
    h.runner.saveConfig({ ...config, enabled: false });
    assert.equal(h.repository.config().enabled, false);
    assert.equal(h.repository.config().actorId, actorId);
    assert.throws(() => h.runner.saveConfig({ ...config, enabled: true }), /Cookie 已失效/);
  } finally { h.close(); }
});

test('confirmed inbound follow from home is retained when follow response omits relationship', async () => {
  const h = harness();
  try {
    h.repository.add(h.record('2', { stage: 'pending_follow', following: false, followedBy: true, followAttemptAt: null, followedAt: null }));
    h.social.follow = async () => ({ following: true, followedBy: null });
    await h.runner.tick();
    assert.equal(h.repository.get('1:2')?.followedBy, true);
    h.advance(DAY); await h.runner.tick();
    assert.equal(h.calls.some(call => call.startsWith('check:')), false);
  } finally { h.close(); }
});
