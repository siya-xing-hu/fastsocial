import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../db/database.ts';
import { DEFAULT_OUTREACH_CONFIG, OutreachRepository } from './repository.ts';
import { OutreachService } from './service.ts';
import type { OutreachAdapter, OutreachClassifier } from './types.ts';
import type { OutreachConfigInput, OutreachRecord } from '@fast-social/contracts';

const DAY = 86400000;
function harness() {
  const db = openDatabase(':memory:');
  let now = Date.parse('2026-09-29T01:00:00Z');
  const repo = new OutreachRepository(db);
  const calls: string[] = [];
  const prompts: string[] = [];
  const social: OutreachAdapter = {
    identity: cookieId => ({ cookieId, actorId: cookieId === 'a' || cookieId === 'a-copy' ? '1' : '9' }),
    home: async identity => { calls.push(`home:${identity.actorId}`); return [{ userId: '2', name: 'Test', following: false, followedBy: false, post: { id: '20', author: 'user2', text: '互关认识朋友', platform: 'x', type: 'post', url: 'https://x.com/user2/status/20', createdAt: new Date(now).toISOString() } }]; },
    follow: async identity => { calls.push(`follow:${identity.actorId}`); return { following: true, followedBy: false }; },
    reply: async (identity, _, text) => { calls.push(`reply:${identity.actorId}:${text}`); return '999'; },
    relationship: async identity => { calls.push(`check:${identity.actorId}`); return { following: true, followedBy: false }; },
  };
  const classifier: OutreachClassifier = { classify: async (posts, prompt) => { prompts.push(prompt); return posts.map(({ post }) => ({ postId: post.id, status: 'match', reason: '互关邀请' })); } };
  const service = new OutreachService(repo, social, classifier, () => now);
  const { id: _id, actorId: _actor, ...defaults } = DEFAULT_OUTREACH_CONFIG;
  const input = (cookieId: string): OutreachConfigInput => ({ ...defaults, cookieId, name: cookieId, prompt: `condition-${cookieId}`, replyText: `hello-${cookieId}`, enabled: true });
  const add = (cookieId: string) => service.create(input(cookieId)).config.id;
  return { db, repo, service, social, classifier, calls, prompts, input, add, now: () => now, advance: (ms = 60000) => { now += ms; }, restart: () => new OutreachService(repo, social, classifier, () => now), close: () => db.close() };
}

test('two accounts browse their own home and alternate requests with independent prompts, replies and records', async () => {
  const h = harness();
  try {
    const a = h.add('a'), b = h.add('b');
    await h.service.tick(); await h.service.tick();
    assert.deepEqual(h.calls, ['home:1']);
    for (let i = 0; i < 5; i += 1) { h.advance(); await h.service.tick(); }
    assert.deepEqual(h.calls, ['home:1', 'home:9', 'follow:1', 'follow:9', 'reply:1:hello-a', 'reply:9:hello-b']);
    assert.deepEqual(h.prompts, ['condition-a', 'condition-b']);
    assert.equal(h.service.view(a).records[0]?.actorId, '1');
    assert.equal(h.service.view(b).records[0]?.actorId, '9');
    assert.equal(h.service.view(a).todayFollowAttempts, 1);
    assert.equal(h.service.view(b).todayFollowAttempts, 1);
    assert.deepEqual(h.repo.recentSeen('1'), ['20']);
    assert.deepEqual(h.repo.recentSeen('9'), ['20']);
  } finally { h.close(); }
});

test('a paused account does not use another identity to retry, and the other account retains its own schedule', async () => {
  const h = harness();
  try {
    const a = h.add('a'), b = h.add('b');
    const home = h.social.home;
    h.social.home = async (identity, seen) => { if (identity.actorId === '1') { h.calls.push('fail:1'); throw new Error('Cookie A error'); } return home(identity, seen); };
    await h.service.tick();
    assert.equal(h.service.view(a).state.pauseReason, 'Cookie A error');
    assert.equal(h.service.view(b).state.pauseReason, null);
    h.advance(); await h.service.tick();
    assert.deepEqual(h.calls, ['fail:1', 'home:9']);
    h.advance(); await h.service.tick();
    assert.deepEqual(h.calls, ['fail:1', 'home:9', 'follow:9']);
  } finally { h.close(); }
});

test('daily quota and disabling one account do not disable the other account', async () => {
  const h = harness();
  try {
    const a = h.add('a'), b = h.add('b');
    h.service.update(a, { ...h.input('a'), dailyLimit: 1 });
    await h.service.tick(); h.advance(); await h.service.tick();
    h.service.toggle(a, false);
    h.advance(); await h.service.tick();
    assert.equal(h.service.view(a).records[0]?.stage, 'pending_follow');
    assert.equal(h.service.view(b).records[0]?.stage, 'pending_reply');
    assert.equal(h.service.view(a).config.dailyLimit, 1);
    assert.equal(h.service.view(b).config.dailyLimit, 10);
  } finally { h.close(); }
});

test('duplicate identities cannot be added through different Cookies and editing cannot swap account identity', () => {
  const h = harness();
  try {
    const a = h.add('a');
    assert.throws(() => h.add('a-copy'), /已添加/);
    assert.throws(() => h.service.update(a, h.input('b')), /不可更换/);
    h.service.update(a, h.input('a-copy'));
    assert.equal(h.service.view(a).config.actorId, '1');
  } finally { h.close(); }
});

test('manual checking is scoped to its account and global cooldown survives restart', async () => {
  const h = harness();
  try {
    const a = h.add('a'), b = h.add('b');
    for (let i = 0; i < 6; i += 1) { await h.service.tick(); h.advance(); }
    h.service.toggle(a, false); h.service.toggle(b, false);
    h.service.startChecks(a);
    await h.service.tick();
    assert.equal(h.calls.at(-1), 'check:1');
    assert.ok(h.service.view(a).records[0]?.lastCheckedAt);
    assert.equal(h.service.view(b).records[0]?.lastCheckedAt, null);
    const restarted = h.restart();
    restarted.startChecks(b); await restarted.tick();
    assert.equal(h.calls.at(-1), 'check:1');
    h.advance(); await restarted.tick();
    assert.equal(h.calls.at(-1), 'check:9');
  } finally { h.close(); }
});

test('each account gets its own one-time 24-hour check', async () => {
  const h = harness();
  try {
    const a = h.add('a'), b = h.add('b');
    for (let i = 0; i < 6; i += 1) { await h.service.tick(); h.advance(); }
    h.advance(DAY); await h.service.tick(); h.advance(); await h.service.tick();
    assert.deepEqual(h.calls.slice(-2), ['check:1', 'check:9']);
    assert.ok(h.service.view(a).records[0]?.autoCheckAttemptAt);
    assert.ok(h.service.view(b).records[0]?.autoCheckAttemptAt);
    h.advance(DAY); await h.restart().tick();
    assert.equal(h.calls.filter(call => call.startsWith('check:')).length, 2);
  } finally { h.close(); }
});

test('removing an account during AI analysis cannot enqueue work; other accounts remain present', async () => {
  const h = harness();
  try {
    const a = h.add('a'); const b = h.add('b');
    let complete!: () => void;
    h.classifier.classify = async () => { await new Promise<void>(resolve => { complete = resolve; }); return [{ postId: '20', status: 'match', reason: '互关' }]; };
    const pending = h.service.tick();
    await new Promise(resolve => setImmediate(resolve));
    h.service.remove(a); complete(); await pending;
    assert.equal(h.repo.get('1:2'), null);
    assert.equal(h.service.list().accounts.length, 1);
    assert.equal(h.service.list().accounts[0]?.config.id, b);
  } finally { h.close(); }
});

test('removing and re-adding an account retains confirmed records, cooldown and deduplication', async () => {
  const h = harness();
  try {
    const a = h.add('a');
    for (let i = 0; i < 3; i += 1) { await h.service.tick(); h.advance(); }
    h.repo.scope(a).patchState({ pauseReason: 'rate limited' });
    h.service.remove(a);
    const added = h.add('a');
    assert.notEqual(a, added);
    assert.equal(h.service.view(added).records.length, 1);
    assert.equal(h.service.view(added).state.pauseReason, 'rate limited');
    assert.equal(h.service.view(added).todayFollowAttempts, 1);
  } finally { h.close(); }
});

test('legacy single account migrates once without losing records or repeating automatic checks', () => {
  const db = openDatabase(':memory:');
  try {
    const legacy = { enabled: false, cookieId: 'old-cookie', actorId: '123', query: '互关', intervalMinutes: 90, dailyLimit: 6, requestGapSeconds: 120, replyText: '认识一下' };
    const put = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
    put.run('outreach_config', JSON.stringify(legacy));
    put.run('x', JSON.stringify({ cookies: [{ id: 'old-cookie', name: '原账号' }] }));
    put.run('outreach_state', JSON.stringify({ nextRequestAt: '2026-09-29T02:00:00Z', lastSearchAt: '2026-09-29T01:00:00Z', pauseReason: 'previous error', checkJob: null }));
    const record = { id: '123:2', actorId: '123', userId: '2', stage: 'done', autoCheckAttemptAt: '2026-09-28T00:00:00Z' } as OutreachRecord;
    db.prepare('INSERT INTO outreach_records (id, value) VALUES (?, ?)').run(record.id, JSON.stringify(record));
    const repo = new OutreachRepository(db);
    const migrated = repo.accounts()[0]!;
    assert.equal(migrated.name, '原账号');
    assert.equal(migrated.dailyLimit, 6);
    assert.equal('query' in migrated, false);
    assert.equal(migrated.prompt, DEFAULT_OUTREACH_CONFIG.prompt);
    assert.equal(repo.scope(migrated.id).state().pauseReason, 'previous error');
    assert.equal(repo.scope(migrated.id).state().lastFetchedAt, null);
    assert.equal(repo.get(record.id)?.autoCheckAttemptAt, record.autoCheckAttemptAt);
    repo.removeAccount(migrated.id);
    assert.equal(new OutreachRepository(db).accounts().length, 0);
  } finally { db.close(); }
});
