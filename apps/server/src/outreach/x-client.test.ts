import { XRequestQueue } from '../adapters/x/request-queue.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../db/database.ts';
import { SettingsRepository } from '../repositories/settings-repository.ts';
import { OutreachXClient, OutreachXError, cookieActorId, parseRelationship, parseFollowState, parseHomePosts } from './x-client.ts';
import { DEFAULT_ACCOUNT_DAILY_LIMITS } from '@fast-social/contracts';
import { AccountRequestLimitError } from '../configuration/request-limits.ts';
import { parseOutreachDecisions } from './classifier.ts';

const user = (id: string) => ({ rest_id: id, core: { screen_name: `user${id}`, name: `User ${id}` }, relationship_perspectives: { following: false, followed_by: true } });
function tweet(id: string, author: string, extra = {}) {
  return { __typename: 'Tweet', rest_id: id, core: { user_results: { result: user(author) } }, legacy: { full_text: '欢迎互关', created_at: 'Tue Sep 29 00:00:00 +0000 2026' }, ...extra };
}
const home = (items: unknown[]) => ({ data: { home: { home_timeline_urt: { instructions: [{ type: 'TimelineAddEntries', entries: items.map(result => ({ content: { itemContent: { tweet_results: { result } } } })) }] } } } });

test('home maps actual timeline authors, ignores quoted/reposted authors, and rejects invalid structure', () => {
  const quoted = tweet('11', '3');
  const original = tweet('10', '2', { quoted_status_result: { result: quoted } });
  const repost = tweet('12', '4', { legacy: { full_text: 'RT', created_at: 'Tue Sep 29 00:00:00 +0000 2026', retweeted_status_result: { result: quoted } } });
  const result = parseHomePosts(home([original, original, repost]));
  assert.equal(result.length, 1);
  assert.equal(result[0]?.userId, '2');
  assert.equal(result[0]?.post.quotedText, '欢迎互关');
  assert.equal(result[0]?.followedBy, true);
  assert.throws(() => parseHomePosts({}), /结构已变化/);
  assert.deepEqual(parseHomePosts(home([])), []);
});

test('relationship absence is unknown, not false; only exact user and boolean values are accepted', () => {
  const payload = { data: { user: { result: user('2') } } };
  assert.deepEqual(parseRelationship(payload, '2'), { following: false, followedBy: true });
  assert.throws(() => parseRelationship(payload, '9'), /目标用户/);
  assert.throws(() => parseRelationship({ data: { user: { result: { rest_id: '2' } } } }, '2'), /完整关注关系/);
  assert.deepEqual(parseRelationship({ data: { user: { result: { rest_id: '2', legacy: { following: true, followed_by: false } } } } }, '2'), { following: true, followedBy: false });
});

test('identity uses twid without a network request and never accepts absent account identity', () => {
  assert.equal(cookieActorId('auth_token=a; ct0=b; twid=u%3D123'), '123');
  assert.equal(cookieActorId('twid="u=123"'), '123');
  assert.throws(() => cookieActorId('auth_token=a; ct0=b'), /twid/);
  assert.throws(() => cookieActorId('twid=%xx'), /twid/);
});
test('a stale or missing following value is confirmed through same-account reads without repeating the follow', async () => {
  for (const initial of [false, undefined]) {
    const db = openDatabase(':memory:'), settings = new SettingsRepository(db);
    const account = settings.configuration.saveAccount({ name: 'A', username: 'actor', cookie: 'auth_token=fake; ct0=csrf; twid=u%3D1' });
    const calls: string[] = []; let reads = 0;
    const client = new OutreachXClient(settings, new XRequestQueue({ intervalMs: 0 }), async (url, options) => {
      calls.push(String(url)); assert.match(new Headers(options?.headers).get('cookie')!, /auth_token=fake/);
      if (String(url).includes('friendships/create')) return Response.json({ id_str: '2', following: initial });
      assert.equal(options?.method, 'GET');
      assert.equal(JSON.parse(new URL(String(url)).searchParams.get('variables')!).userId, '2');
      return Response.json({ data: { user: { result: { rest_id: '2', relationship_perspectives: { following: ++reads === 2 } } } } });
    });
    try {
      assert.deepEqual(await client.follow(client.identity(account.id), '2'), { following: true, followedBy: null });
      assert.equal(calls.filter(url => url.includes('friendships/create')).length, 1); assert.equal(reads, 2);
      assert.equal(settings.configuration.requestLimits.view(account.id).used.follow, 1);
      assert.equal(settings.configuration.requestLimits.view(account.id).used.profile, 2);
    } finally { db.close(); }
  }
});
test('confirmation requires the intended target and only needs the outgoing relationship', () => {
  const payload = { data: { user: { result: { rest_id: '2', relationship_perspectives: { following: true } } } } };
  assert.deepEqual(parseFollowState(payload, '2'), { following: true, followedBy: null });
  assert.throws(() => parseFollowState(payload, '3'), /目标用户/);
  assert.throws(() => parseRelationship(payload, '2'), /完整关注关系/);
});
test('known handles confirm follows through Profile with strict target matching, and unfollow has its own quota', async () => {
  const db = openDatabase(':memory:'), settings = new SettingsRepository(db);
  const account = settings.configuration.saveAccount({ name: 'A', username: 'actor', cookie: 'auth_token=fake; ct0=csrf; twid=u%3D1', dailyLimits: {...DEFAULT_ACCOUNT_DAILY_LIMITS, unfollow:1} });
  const requests: string[] = []; let target = '2', following = true;
  const client = new OutreachXClient(settings, new XRequestQueue({ intervalMs: 0 }), async (url, options) => {
    const path = new URL(String(url)).pathname; requests.push(path);
    if (path.endsWith('create.json')) return Response.json({id_str:'2',following:false});
    if (path.endsWith('destroy.json')) { following=false; return Response.json({id_str:'2',following:false}); }
    assert.ok(path.endsWith('/UserByScreenName')); assert.equal(options?.method,'GET');
    assert.equal(new Headers(options?.headers).get('referer'),'https://x.com/target');
    return Response.json({data:{user:{result:{rest_id:target,core:{screen_name:'target',name:'Target'},relationship_perspectives:{following,followed_by:true}}}}});
  });
  try {
    const identity=client.identity(account.id);
    assert.equal((await client.follow(identity,'2','target')).following,true);
    assert.ok(requests.every(path=>!path.includes('UserByRestId')));
    target='3'; await assert.rejects(client.profile(identity,'target','2'),/不一致/); target='2';
    assert.equal((await client.unfollow(identity,'2','target')).following,false);
    await assert.rejects(client.unfollow(identity,'2','target'),AccountRequestLimitError);
    assert.equal(requests.filter(path=>path.endsWith('destroy.json')).length,1);
    assert.equal(settings.configuration.requestLimits.view(account.id).used.unfollow,1);
  } finally {db.close();}
});
test('unconfirmed follows stay unconfirmed and read quota errors after sending are not retryable unsent actions', async () => {
  for (const blocked of [false, true]) {
    const db = openDatabase(':memory:'), settings = new SettingsRepository(db);
    const account = settings.configuration.saveAccount({ name: 'A', username: 'actor', cookie: 'auth_token=fake; ct0=csrf; twid=u%3D1',
      dailyLimits: { ...DEFAULT_ACCOUNT_DAILY_LIMITS, profile: blocked ? 0 : 10 } });
    let follows = 0, reads = 0;
    const client = new OutreachXClient(settings, new XRequestQueue({ intervalMs: 0 }), async url => {
      if (String(url).includes('friendships/create')) { follows++; return Response.json({ id_str: '2', following: false }); }
      reads++; return Response.json({ data: { user: { result: user('2') } } });
    });
    try {
      if (blocked) await assert.rejects(client.follow(client.identity(account.id), '2'), error =>
        error instanceof OutreachXError && !(error instanceof AccountRequestLimitError) && error.message.includes('关注请求已发送'));
      else assert.equal((await client.follow(client.identity(account.id), '2')).following, false);
      assert.equal(follows, 1); assert.equal(reads, blocked ? 0 : 2);
    } finally { db.close(); }
  }
});

test('all operations use the selected account, reply targets original post, errors never switch cookies or retry', async () => {
  const db = openDatabase(':memory:');
  try {
    const settings = new SettingsRepository(db);
    settings.update({ x: { cookies: [
      { id: 'a', name: 'A', enabled: true, cookie: 'auth_token=fake-a; ct0=fake-csrf; twid=u%3D1' },
      { id: 'b', name: 'B', enabled: true, cookie: 'auth_token=fake-b; ct0=other; twid=u%3D2' },
    ] } });
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    let fail = false;
    const client = new OutreachXClient(settings, new XRequestQueue({ intervalMs: 0 }), (async (url, init) => {
      calls.push({ url: String(url), init });
      if (fail) return new Response(JSON.stringify({ errors: [{ code: 88 }] }), { status: 429, headers: { 'retry-after': '9000' } });
      if (String(url).includes('HomeTimeline')) return Response.json(home([]));
      if (String(url).includes('friendships/create')) return Response.json({ id_str: '3', following: true, followed_by: false });
      if (String(url).includes('CreateTweet')) return Response.json({ data: { create_tweet: { tweet_results: { result: { rest_id: '12345' } } } } });
      return Response.json({ data: { user: { result: user('3') } } });
    }) as typeof fetch);
    const identity = client.identity('a');
    assert.equal(calls.length, 0);
    await client.home(identity, ['42']);
    await client.follow(identity, '3');
    await client.reply(identity, '300', '已关注，互相联系～');
    await client.relationship(identity, '3');
    assert.equal(calls.length, 4);
    assert.ok(calls.every(({ init }) => new Headers(init?.headers).get('cookie')?.includes('fake-a')));
    assert.equal(new URLSearchParams(String(calls[1]!.init!.body)).get('user_id'), '3');
    assert.equal(JSON.parse(String(calls[2]!.init!.body)).variables.reply.in_reply_to_tweet_id, '300');
    const homeRequest = JSON.parse(String(calls[0]!.init!.body));
    assert.equal(calls[0]!.init!.method, 'POST');
    assert.equal(homeRequest.variables.cursor, undefined);
    assert.equal(homeRequest.variables.rawQuery, undefined);
    assert.deepEqual(homeRequest.variables.seenTweetIds, ['42']);
    assert.equal(homeRequest.variables.count, 20);
    assert.equal(new Headers(calls[0]!.init!.headers).get('referer'), 'https://x.com/home');
    fail = true;
    await assert.rejects(client.home(identity, ['42']), error => error instanceof OutreachXError && error.retryAfterSeconds === 9000);
    assert.equal(calls.length, 5);
    assert.equal(settings.getX().cookies[0]!.status, 'unchecked');
    settings.update({ x: { cookies: [{ id: 'a', name: 'A', enabled: true, cookie: 'auth_token=fake-new; ct0=fake; twid=u%3D9' }] } });
    await assert.rejects(client.follow(identity, '3'), /账号已改变/);
    assert.equal(calls.length, 5);
  } finally { db.close(); }
});

test('AI classification rejects duplicate, omitted, invented and invalid decisions', () => {
  const posts = parseHomePosts(home([tweet('10', '2'), tweet('11', '3')]));
  const decision = (postId: string, status = 'match') => ({ postId, status, reason: '明确互关' });
  const raw = (decisions: unknown[]) => JSON.stringify({ decisions });
  assert.equal(parseOutreachDecisions(raw([decision('10'), decision('11', 'uncertain')]), posts).length, 2);
  for (const decisions of [[decision('10')], [decision('10'), decision('10')], [decision('10'), decision('99')], [decision('10'), decision('11', 'follow_now')]]) {
    assert.throws(() => parseOutreachDecisions(raw(decisions), posts), /遗漏|无效/);
  }
});

test('HTML rate-limit responses preserve Retry-After and authentication errors invalidate only selected Cookie', async () => {
  const db = openDatabase(':memory:');
  try {
    const settings = new SettingsRepository(db);
    settings.update({ x: { cookies: [
      { id: 'a', name: 'A', enabled: true, cookie: ' auth_token=fake; ct0=fake; twid=u%3D1 ' },
      { id: 'b', name: 'B', enabled: true, cookie: 'auth_token=other; ct0=other; twid=u%3D2' },
    ] } });
    let status = 429;
    const client = new OutreachXClient(settings, new XRequestQueue({ intervalMs: 0 }), (async () => new Response('<html>Unavailable</html>', { status, headers: { 'retry-after': '8000' } })) as typeof fetch);
    const identity = client.identity('a');
    await assert.rejects(client.home(identity, ['42']), error => error instanceof OutreachXError && error.retryAfterSeconds === 8000);
    status = 401;
    await assert.rejects(client.home(identity, ['42']));
    assert.equal(settings.getX().cookies[0]?.status, 'invalid');
    assert.equal(settings.getX().cookies[1]?.status, 'unchecked');
  } finally { db.close(); }
});
test('226 refusals in HTTP 200 and 403 identify automation blocking without retrying or invalidating credentials', async () => {
  for (const status of [200, 403]) {
    const db = openDatabase(':memory:'), settings = new SettingsRepository(db);
    const account = settings.configuration.saveAccount({ name: 'A', username: 'actor', cookie: 'auth_token=fake; ct0=csrf; twid=u%3D1' });
    let requests = 0;
    const client = new OutreachXClient(settings, new XRequestQueue({ intervalMs: 0 }), async url => {
      requests++;
      assert.ok(String(url).endsWith('/CreateTweet'));
      return Response.json({ data: {}, errors: [{ code: 226, message: 'This request looks like it might be automated.' }] }, { status });
    });
    try {
      await assert.rejects(client.reply(client.identity(account.id), '100', 'A reply'), error => {
        assert.ok(error instanceof OutreachXError);
        assert.match(error.message, /X 拒绝了回复请求.*代码 226.*自动化或垃圾内容/);
        assert.ok(error.message.includes(`HTTP ${status}`));
        assert.doesNotMatch(error.message, /核对账号或请求参数/);
        return true;
      });
      assert.equal(requests, 1);
      assert.equal(settings.configuration.requestLimits.view(account.id).used.reply, 1);
      assert.notEqual(settings.getX().cookies.find(cookie => cookie.id === account.id)?.status, 'invalid');
    } finally { db.close(); }
  }
});
test('Cloudflare HTML denial identifies the blocked read without invalidating the Cookie or repeating the follow', async () => {
  const db = openDatabase(':memory:'), settings = new SettingsRepository(db);
  const account = settings.configuration.saveAccount({ name: 'A', username: 'actor', cookie: 'auth_token=fake; ct0=csrf; twid=u%3D1' });
  let requests = 0;
  const client = new OutreachXClient(settings, new XRequestQueue({ intervalMs: 0 }), async () => ++requests === 1
    ? Response.json({ id_str: '2', following: false })
    : new Response('<html><title>Attention Required! | Cloudflare</title></html>', { status: 403, headers: { server: 'cloudflare', 'content-type': 'text/html' } }));
  try {
    await assert.rejects(client.follow(client.identity(account.id), '2'), /关注请求已发送.*Cloudflare.*关注关系查询.*HTTP 403/);
    assert.equal(requests, 2); assert.notEqual(settings.getX().cookies[0]?.status, 'invalid');
  } finally { db.close(); }
});
