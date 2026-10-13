import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { XRequestQueue, withXRequestGuard, withQueuedXRequests } from './request-queue.ts';
import { XClient } from './x-client.ts';
import { OutreachXClient } from '../../outreach/x-client.ts';
import { openDatabase } from '../../db/database.ts';
import { SettingsRepository } from '../../repositories/settings-repository.ts';
import { createApp } from '../../app.ts';
import type { TraceEntry } from '../../observability/trace.ts';

test('one queue serializes concurrent operations and waits 10 seconds after completion, including failures', async () => {
  let now = 0;
  const starts: number[] = [], waits: number[] = [];
  const queue = new XRequestQueue({ now: () => now, wait: async ms => { waits.push(ms); now += ms; } });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const first = queue.run(async () => { starts.push(now); await gate; now += 700; return 'first'; });
  const second = queue.run(async () => { starts.push(now); now += 100; throw new Error('network'); });
  const third = queue.run(async () => { starts.push(now); return 'third'; });
  const finished = Promise.allSettled([first, second, third]);
  await setImmediate();
  assert.deepEqual(starts, [0]);
  release();
  assert.deepEqual((await finished).map(result => result.status), ['fulfilled', 'rejected', 'fulfilled']);
  assert.deepEqual(starts, [0, 10_700, 20_800]);
  assert.deepEqual(waits, [10_000, 10_000]);
  queue.stop();
});

test('queue cancellation and preflight failure send nothing and do not reserve another interval', async () => {
  let now = 0, valid = true, starts = 0, quota = 0;
  const queue = new XRequestQueue({ now: () => now, wait: async ms => { now += ms; valid = false; } });
  await queue.run(async () => {});
  await assert.rejects(withXRequestGuard(() => { if (!valid) throw new Error('workflow changed'); }, () =>
    withXRequestGuard(() => {}, () => queue.run(async () => { starts++; }, () => { quota++; }))), /workflow changed/);
  assert.equal(starts, 0); assert.equal(quota, 0);
  await assert.rejects(queue.run(async () => { starts++; }, () => { throw new Error('quota exhausted'); }), /quota exhausted/);
  await queue.run(async () => { starts++; });
  assert.equal(now, 10_000); assert.equal(starts, 1);
  queue.stop();
});

test('shutdown cancels the wait and every queued request without spending quota or waiting 10 seconds', async () => {
  const queue = new XRequestQueue();
  let sends = 0, quota = 0;
  await queue.run(async () => { sends++; });
  const second = queue.run(async () => { sends++; }, () => { quota++; });
  const third = queue.run(async () => { sends++; }, () => { quota++; });
  const cancelled = Promise.allSettled([second, third]);
  await setImmediate();
  queue.stop();
  for (const result of await cancelled) {
    assert.equal(result.status, 'rejected');
    if (result.status === 'rejected') assert.match(result.reason.message, /排队中的 X 请求未发送/);
  }
  assert.equal(sends, 1); assert.equal(quota, 0);
  await assert.rejects(queue.run(async () => { sends++; }), /服务正在停止/);
});

test('reader and action clients share spacing across accounts; Cookie edits and daily limits are checked at send time', async () => {
  const db = openDatabase(':memory:'), settings = new SettingsRepository(db);
  const a = settings.configuration.saveAccount({ name: 'A', username: 'actor_a', cookie: 'auth_token=fake-a; ct0=csrf; twid=u%3D1' });
  const b = settings.configuration.saveAccount({ name: 'B', username: 'actor_b', cookie: 'auth_token=fake-b; ct0=csrf; twid=u%3D2' });
  let now = 0;
  let onWait = () => { assert.equal(settings.configuration.requestLimits.view(b.id).used.reply, 0); };
  const calls: Array<{ at: number; path: string; cookie: string }> = [];
  const queue = new XRequestQueue({ now: () => now, wait: async ms => {
    now += ms; onWait();
  } });
  const mock: typeof fetch = async (url, init) => {
    assert.equal(init?.signal?.aborted, false);
    const path = new URL(String(url)).pathname;
    calls.push({ at: now, path, cookie: new Headers(init?.headers).get('cookie')! });
    now += 500;
    if (path.endsWith('/HomeTimeline')) return Response.json({ data: { home: { home_timeline_urt: { instructions: [] } } } });
    assert.ok(path.endsWith('/CreateTweet'));
    return Response.json({ data: { create_tweet: { tweet_results: { result: { rest_id: '900' } } } } });
  };
  const reader = new XClient(settings, queue, mock), actions = new OutreachXClient(settings, queue, mock);
  try {
    await withQueuedXRequests(() => Promise.all([reader.fetchHomePosts(a.id), actions.reply(actions.identity(b.id), '100', 'Reply')]));
    assert.deepEqual(calls.map(call => call.at), [0, 10_500]);
    assert.match(calls[0]!.cookie, /fake-a/); assert.match(calls[1]!.cookie, /fake-b/);
    assert.equal(settings.configuration.requestLimits.view(b.id).used.reply, 1);
    // The next read is queued with A's old credentials. Changing them must not send those credentials.
    onWait = () => {
      settings.configuration.saveAccount({ ...a, cookie: 'auth_token=new; ct0=csrf; twid=u%3D1' }, a.id);
      const limits = settings.configuration.requestLimits.limits(b.id);
      settings.configuration.requestLimits.save(b.id, { ...limits, reply: 0 });
    };
    const used = settings.configuration.requestLimits.view(b.id).used;
    const cancelled = await withQueuedXRequests(() => Promise.allSettled([reader.fetchHomePosts(a.id), actions.reply(actions.identity(b.id), '101', 'Another reply')]));
    assert.equal(cancelled[0]!.status, 'rejected');
    if (cancelled[0]!.status === 'rejected') assert.match(cancelled[0]!.reason.message, /排队期间账号 Cookie 已修改/);
    assert.equal(cancelled[1]!.status, 'rejected');
    if (cancelled[1]!.status === 'rejected') assert.match(cancelled[1]!.reason.message, /已禁止回复/);
    assert.equal(calls.length, 2);
    assert.equal(settings.configuration.requestLimits.view(a.id).used.home, 1);
    assert.deepEqual(settings.configuration.requestLimits.view(b.id).used, used);
    assert.equal(now, 21_000); // Neither cancelled request adds a cooldown.
  } finally { queue.stop(); db.close(); }
});

test('manual account tests bypass the queue while workflow reads and writes retain spacing without delaying AI', async () => {
  let now = 0;
  const logs: TraceEntry[] = [];
  const calls: Array<{ name: string; at: number }> = [];
  const queue = new XRequestQueue({ now: () => now, wait: async ms => { now += ms; } });
  const app = createApp({ traceSink: entry => logs.push(structuredClone(entry)), xRequestQueue: queue, fetchImpl: async (url, init) => {
    if (String(url).startsWith('https://fixture.invalid/')) {
      calls.push({ name: 'AI', at: now });
      return Response.json({ choices: [{ message: { content: JSON.stringify({ matches: [{ postId: '100', message: 'match' }] }) } }] });
    }
    assert.ok(String(url).startsWith('https://x.com/'));
    const name = new URL(String(url)).pathname.split('/').at(-1)!;
    calls.push({ name, at: now }); now += 200;
    if (name === 'CreateTweet') return Response.json({ data: { create_tweet: { tweet_results: { result: { rest_id: '900' } } } } });
    assert.equal(name, 'HomeTimeline');
    const tweet = { __typename: 'Tweet', rest_id: '100', core: { user_results: { result: { rest_id: '9', core: { screen_name: 'author', name: 'Author' } } } },
      legacy: { full_text: 'A launch', created_at: new Date(Date.now() + 60_000).toUTCString() } };
    return Response.json({ data: { home: { home_timeline_urt: { instructions: [{ type: 'TimelineAddEntries', entries: [{ content: { itemContent: { tweet_results: { result: tweet } } } }] }] } } } });
  } });
  try {
    const account = (await app.inject({ method: 'POST', url: '/api/accounts', payload: { name: 'A', username: 'actor', cookie: 'auth_token=fake; ct0=csrf; twid=u%3D1' } })).json().data;
    await app.inject({ method: 'PUT', url: '/api/settings', payload: { ai: { defaultProvider: 'fixture:model', services: [{ id: 'fixture', name: 'AI', endpoint: 'https://fixture.invalid/v1/chat/completions', apiKey: 'fake', enabled: true, models: [{ name: 'model' }] }] } } });
    const workflow = (await app.inject({ method: 'POST', url: '/api/workflows', payload: { name: 'Mock', accountId: account.id, source: 'home', usernames: [], condition: 'launch', intervalMinutes: 60, enabled: false, actions: [{ type: 'reply', mode: 'text', text: 'A reply' }] } })).json().data;
    assert.equal((await app.inject({ method: 'POST', url: `/api/accounts/${account.id}/test` })).statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', url: `/api/workflows/${workflow.id}/run` })).statusCode, 202);
    // Poll the local in-memory run only; no real X or AI request can leave this fixture.
    let run;
    const deadline = Date.now() + 2_000; // No extra three-second action sleep.
    do {
      await new Promise(resolve => setTimeout(resolve, 20));
      run = (await app.inject('/api/workflows/runs')).json().data[0];
    } while (run.status === 'running' && Date.now() < deadline);
    assert.equal(run.status, 'done', run.error);
    assert.deepEqual(calls.filter(call => call.name !== 'AI'), [
      { name: 'HomeTimeline', at: 0 }, { name: 'HomeTimeline', at: 200 }, { name: 'CreateTweet', at: 10_400 },
    ]);
    assert.equal(calls.find(call => call.name === 'AI')?.at, 400);
    const chain = logs.filter(entry => entry.context.runId === run.id);
    assert.equal(chain[0]?.event, 'workflow.start'); assert.equal(chain.at(-1)?.event, 'workflow.finish');
    assert.ok(chain.some(entry => entry.event === 'workflow.fetch.done' && entry.data.count === 1));
    assert.equal(chain.filter(entry => entry.event === 'http.request').length, 3);
    assert.deepEqual(chain.filter(entry => entry.event === 'http.request').map(entry => entry.message),
      ['获取账号首页：curl', 'AI 判断：curl', '回复 Post：curl']);
    const request = chain.find(entry => entry.event === 'http.request' && String(entry.data.url).endsWith('/CreateTweet'))!;
    assert.equal(request.context.postId, '100'); assert.equal(request.context.accountId, account.id);
    assert.match(String(request.data.curl), /A reply/); assert.match(String(request.data.curl), /auth_token=fake/);
    assert.ok(chain.some(entry => entry.event === 'http.response' && entry.context.requestId === request.context.requestId));
    assert.equal(chain.at(-1)?.data.completed, 1);
    // The separate manual account test has its own HTTP trace, not the workflow's identity.
    assert.ok(logs.some(entry => entry.event === 'http.request' && entry.context.route === `/api/accounts/${account.id}/test` && !entry.context.runId));
    assert.ok(logs.some(entry => entry.event === 'http.request' && entry.context.requestMode === 'direct' && !entry.context.runId));
    assert.ok(chain.filter(entry => entry.event === 'http.request' && entry.context.system === 'X').every(entry => entry.context.requestMode === 'queued'));
  } finally { await app.close(); }
});

test('direct requests bypass a busy task queue but keep guards, quotas and shutdown checks', async () => {
  let now = 0, sends = 0, checks = 0;
  const waiting = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const queue = new XRequestQueue({ now: () => now, wait: async ms => { waiting.resolve(); await release.promise; now += ms; } });
  await withQueuedXRequests(() => queue.request(async () => { sends++; }));
  const task = withQueuedXRequests(() => queue.request(async () => { sends++; }, () => { checks++; }));
  try {
    await waiting.promise;
    await queue.request(async () => { sends++; }, () => { checks++; });
    assert.equal(sends, 2); assert.equal(checks, 1); assert.equal(now, 0);
    await assert.rejects(queue.request(async () => { sends++; }, () => { throw new Error('quota exhausted'); }), /quota exhausted/);
    await assert.rejects(withXRequestGuard(() => { throw new Error('cancelled'); }, () => queue.request(async () => { sends++; })), /cancelled/);
    assert.equal(sends, 2);
    release.resolve(); await task;
    assert.equal(now, 10_000); assert.equal(sends, 3); assert.equal(checks, 2);
    queue.stop();
    await assert.rejects(queue.request(async () => { sends++; }), /服务正在停止/);
    assert.equal(sends, 3);
  } finally { release.resolve(); queue.stop(); await task.catch(() => {}); }
});
