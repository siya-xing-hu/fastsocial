import { XRequestQueue, withQueuedXRequests } from '../adapters/x/request-queue.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_ACCOUNT_DAILY_LIMITS } from '@fast-social/contracts';
import { openDatabase } from '../db/database.ts';
import { SettingsRepository } from '../repositories/settings-repository.ts';
import { AccountRequestLimits, AccountRequestLimitError, validateDailyLimits } from './request-limits.ts';
import { XClient } from '../adapters/x/x-client.ts';
import { OutreachXClient } from '../outreach/x-client.ts';
import { createApp } from '../app.ts';
import { FollowingRepository } from '../following/repository.ts';

const input = { name: '账号', username: 'actor', cookie: 'auth_token=test; ct0=csrf; twid=u%3D1' };
test('manual relation checks bypass waiting tasks and return quota errors before sending or changing portrait state', async () => {
  const db = openDatabase(':memory:'), settings = new SettingsRepository(db);
  const account = settings.configuration.saveAccount({ ...input, dailyLimits: { ...DEFAULT_ACCOUNT_DAILY_LIMITS, profile: 1, posts: 0, home: 1 } });
  let now = 0;
  const waiting = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const queue = new XRequestQueue({ now: () => now, wait: async ms => { waiting.resolve(); await release.promise; now += ms; } });
  const calls: string[] = [];
  const app = createApp({ database: db, xRequestQueue: queue, fetchImpl: async url => {
    assert.ok(String(url).startsWith('https://x.com/'));
    calls.push(new URL(String(url)).pathname.split('/').at(-1)!);
    if (calls.at(-1) === 'HomeTimeline') return Response.json({ data: { home: { home_timeline_urt: { instructions: [] } } } });
    assert.equal(calls.at(-1), 'UserByScreenName');
    return Response.json({ data: { user: { result: { rest_id: '9', core: { screen_name: 'target', name: 'Target' },
      relationship_perspectives: { following: true, followed_by: false } } } } });
  } });
  const following = new FollowingRepository(db);
  const entry = following.save({ ...following.create('1', { id: '9', username: 'target', name: 'Target', bio: '', fetchedAt: '' }, 'manual'),
    summaryStatus: 'done', summary: '保留画像' });
  await withQueuedXRequests(() => queue.request(async () => {}));
  const task = withQueuedXRequests(() => queue.request(async () => {}));
  try {
    await waiting.promise;
    const path = `/api/accounts/${account.id}/following/${entry.id}`;
    assert.equal((await app.inject({ method: 'POST', url: `${path}/refresh` })).statusCode, 200);
    assert.equal(now, 0);
    for (const operation of ['refresh', 'summary']) {
      const response = await app.inject({ method: 'POST', url: `${path}/${operation}` });
      assert.equal(response.statusCode, 429); assert.equal(response.json().error.code, 'ACCOUNT_DAILY_LIMIT');
      assert.match(response.json().error.message, /每日额度已用尽（1\/1）/);
    }
    settings.configuration.requestLimits.save(account.id, { ...settings.configuration.requestLimits.limits(account.id), profile: 2 });
    const summary = await app.inject({ method: 'POST', url: `${path}/summary` });
    assert.equal(summary.statusCode, 429); assert.equal(summary.json().error.code, 'ACCOUNT_DAILY_LIMIT');
    assert.match(summary.json().error.message, /已禁止/);
    assert.equal(following.get('1', entry.id)?.summaryStatus, 'done');
    assert.equal(following.get('1', entry.id)?.summary, '保留画像');
    assert.equal(settings.configuration.requestLimits.view(account.id).used.profile, 1);
    assert.equal((await app.inject({ method: 'POST', url: `/api/accounts/${account.id}/test` })).statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', url: `/api/accounts/${account.id}/test` })).statusCode, 429);
    assert.equal(now, 0); assert.deepEqual(calls, ['UserByScreenName', 'HomeTimeline']);
  } finally { release.resolve(); await task; await app.close(); }
});
test('daily limits persist across connections and restarts, isolate actions and accounts, and reset at Shanghai midnight', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fastsocial-quota-')), path = join(dir, 'test.db');
  let db = openDatabase(path), other = openDatabase(path);
  let now = Date.parse('2026-10-10T15:59:59Z');
  try {
    const settings = new SettingsRepository(db), account = settings.configuration.saveAccount({ ...input,
      dailyLimits: { ...DEFAULT_ACCOUNT_DAILY_LIMITS, home: 2, follow: 0 } });
    const quota = new AccountRequestLimits(db, () => now), second = new AccountRequestLimits(other, () => now);
    quota.consume(account.id, 'home'); second.consume(account.id, 'home');
    assert.throws(() => quota.consume(account.id, 'home'), AccountRequestLimitError);
    assert.throws(() => quota.consume(account.id, 'follow'), AccountRequestLimitError);
    second.consume(account.id, 'reply'); assert.equal(quota.view(account.id).used.reply, 1);
    const b = settings.configuration.saveAccount({ ...input, username: 'second', cookie: 'auth_token=b; ct0=b; twid=u%3D2' });
    assert.equal(quota.view(b.id).used.home, 0);
    assert.equal(quota.view(account.id).day, '2026-10-10');
    assert.equal(quota.view(account.id).resetsAt, '2026-10-10T16:00:00.000Z');
    db.close(); db = openDatabase(path);
    const reopened = new AccountRequestLimits(db, () => now);
    assert.equal(reopened.view(account.id).used.home, 2); assert.equal(reopened.limits(account.id).home, 2);
    now += 1000;
    assert.equal(reopened.view(account.id).day, '2026-10-11'); assert.equal(reopened.view(account.id).used.home, 0);
    reopened.consume(account.id, 'home'); assert.equal(reopened.view(account.id).used.home, 1);
  } finally { db.close(); other.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('account edits retain quotas and usage, including newly resolved twid and delete/re-add of a known actor', () => {
  const db = openDatabase(':memory:'), config = new SettingsRepository(db).configuration;
  try {
    const account = config.saveAccount({ ...input, cookie: 'auth_token=test; ct0=csrf', dailyLimits: { ...DEFAULT_ACCOUNT_DAILY_LIMITS, profile: 2 } });
    config.requestLimits.consume(account.id, 'profile');
    config.saveAccount(input, account.id); config.requestLimits.consume(account.id, 'profile');
    assert.equal(config.requestLimits.view(account.id).used.profile, 2);
    assert.throws(() => config.requestLimits.consume(account.id, 'profile'), AccountRequestLimitError);
    config.saveAccount({ ...input, cookie: 'auth_token=test; ct0=csrf' }, account.id);
    assert.equal(config.requestLimits.view(account.id).used.profile, 2);
    config.deleteAccount(account.id); const replaced = config.saveAccount(input);
    assert.equal(config.requestLimits.view(replaced.id).used.profile, 2);
  } finally { db.close(); }
});
test('invalid daily limits cannot silently become unlimited or zero', () => {
  assert.deepEqual(validateDailyLimits(DEFAULT_ACCOUNT_DAILY_LIMITS), DEFAULT_ACCOUNT_DAILY_LIMITS);
  for (const value of [null, {}, [], { ...DEFAULT_ACCOUNT_DAILY_LIMITS, reply: -1 }, { ...DEFAULT_ACCOUNT_DAILY_LIMITS, follow: 1.5 },
    { ...DEFAULT_ACCOUNT_DAILY_LIMITS, home: '100' }, { ...DEFAULT_ACCOUNT_DAILY_LIMITS, profile: 100001 }, { ...DEFAULT_ACCOUNT_DAILY_LIMITS, typo: 2 }])
    assert.throws(() => validateDailyLimits(value), /额度/);
});
test('both X clients share home quotas; profiles, timeline pages, follows and replies count at the request boundary', async () => {
  const db = openDatabase(':memory:'), settings = new SettingsRepository(db);
  const account = settings.configuration.saveAccount({ ...input, dailyLimits: { home: 1, profile: 2, posts: 2, follow: 1, unfollow: 1, reply: 1 } });
  const requests: string[] = [];
  const timeline = JSON.parse(readFileSync(new URL('../adapters/x/__fixtures__/user-timeline.json', import.meta.url), 'utf8'));
  const fetchMock: typeof fetch = async url => {
    requests.push(String(url));
    if (String(url).includes('HomeTimeline')) return Response.json({ data: { home: { home_timeline_urt: { instructions: [] } } } });
    if (String(url).includes('UserByScreenName')) return Response.json({ data: { user: { result: { rest_id: '42', legacy: { screen_name: 'example' } } } } });
    if (String(url).includes('friendships/create')) return Response.json({ id_str: '42', following: true });
    if (String(url).includes('CreateTweet')) return Response.json({ data: { create_tweet: { tweet_results: { result: { rest_id: '999' } } } } });
    return Response.json(timeline);
  };
  const x = new XClient(settings, new XRequestQueue({ intervalMs: 0 }), fetchMock), actions = new OutreachXClient(settings, new XRequestQueue({ intervalMs: 0 }), fetchMock), identity = actions.identity(account.id);
  try {
    await x.fetchHomePosts(account.id);
    await assert.rejects(actions.home(identity, []), AccountRequestLimitError);
    const target = await x.fetchAccount('example', account.id);
    await x.fetchTimelinePage(target, undefined, 'posts', account.id); await x.fetchTimelinePage(target, 'next', 'replies', account.id);
    await assert.rejects(x.fetchTimelinePage(target, 'more', 'posts', account.id), AccountRequestLimitError);
    await actions.follow(identity, '42'); await assert.rejects(actions.follow(identity, '43'), AccountRequestLimitError);
    await actions.reply(identity, '200', 'hello'); await assert.rejects(actions.reply(identity, '201', 'hello'), AccountRequestLimitError);
    assert.equal(requests.length, 6);
    assert.deepEqual(settings.configuration.requestLimits.view(account.id).used, { home: 1, profile: 1, posts: 2, follow: 1, unfollow: 0, reply: 1 });
  } finally { db.close(); }
});
test('failed requests consume quota and a limit rejection never retries with a different account', async () => {
  const db = openDatabase(':memory:'), settings = new SettingsRepository(db);
  const a = settings.configuration.saveAccount({ ...input, dailyLimits: { ...DEFAULT_ACCOUNT_DAILY_LIMITS, profile: 1 } });
  const b = settings.configuration.saveAccount({ ...input, username: 'other', cookie: 'auth_token=b; ct0=b; twid=u%3D2' });
  let calls = 0;
  const x = new XClient(settings, new XRequestQueue({ intervalMs: 0 }), async () => { calls++; throw new Error('network'); }, () => .99);
  try {
    await assert.rejects(x.fetchAccount('example', a.id), /network/);
    await assert.rejects(x.fetchAccount('example'), AccountRequestLimitError);
    assert.equal(calls, 1); assert.equal(settings.configuration.requestLimits.view(a.id).used.profile, 1);
    assert.equal(settings.configuration.requestLimits.view(b.id).used.profile, 0);
  } finally { db.close(); }
});
test('account APIs save limits, expose usage without credentials, and reject a test before a blocked network request', async () => {
  let calls = 0;
  const app = createApp({ xRequestQueue: new XRequestQueue({ intervalMs: 0 }), fetchImpl: async () => { calls++; throw new Error('must not fetch'); } });
  try {
    const created = await app.inject({ method: 'POST', url: '/api/accounts', payload: { ...input, dailyLimits: { ...DEFAULT_ACCOUNT_DAILY_LIMITS, home: 0 } } });
    assert.equal(created.statusCode, 200); const account = created.json().data;
    const response = await app.inject({ method: 'POST', url: `/api/accounts/${account.id}/test` });
    assert.equal(response.statusCode, 429); assert.equal(response.json().error.code, 'ACCOUNT_DAILY_LIMIT'); assert.equal(calls, 0);
    const usage = await app.inject(`/api/accounts/${account.id}/usage`);
    assert.equal(usage.json().data.limits.home, 0); assert.equal(usage.json().data.used.home, 0);
    assert.ok(!usage.body.includes('auth_token'));
    const invalid = await app.inject({ method: 'PUT', url: `/api/accounts/${account.id}`, payload: { ...input, dailyLimits: { ...DEFAULT_ACCOUNT_DAILY_LIMITS, reply: -1 } } });
    assert.equal(invalid.statusCode, 400);
  } finally { await app.close(); }
});
