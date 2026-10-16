import { XRequestQueue } from '../adapters/x/request-queue.ts';
import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { openDatabase } from "../db/database.ts";
import { SettingsRepository } from "../repositories/settings-repository.ts";
import { WorkflowRepository } from "./repository.ts";
import { WorkflowService } from "./service.ts";
import { registerWorkflowRoutes, validateWorkflow } from "./routes.ts";
import { RANDOM_WORKFLOW_ACCOUNT, type SocialPost, type WorkflowInput } from "@fast-social/contracts";
import { AIGateway } from '../ai/ai-gateway.ts';
import { OpenAICompatibleClient } from '../ai/openai-compatible-client.ts';
import { WorkflowMatcher } from './matcher.ts';
import { AccountRequestLimits, AccountRequestLimitError } from '../configuration/request-limits.ts';
import { DEFAULT_ACCOUNT_DAILY_LIMITS } from '@fast-social/contracts';
import { OutreachXClient } from '../outreach/x-client.ts';
import { FollowingRepository } from '../following/repository.ts';
import { FollowingService } from '../following/service.ts';
import { ExecutionLogger, type TraceEntry } from '../observability/trace.ts';
function fixture() {
  const db = openDatabase(":memory:"),
    settings = new SettingsRepository(db),
    repo = new WorkflowRepository(db),
    calls: string[] = [];
  const account = settings.configuration.saveAccount({
    name: "执行账号",
    username: "actor",
    cookie: "auth_token=secret; ct0=csrf; twid=u%3D1",
    configIds: [],
  });
  const post: SocialPost = {
    platform: "x",
    id: "100",
    author: "author",
    text: "launch",
    createdAt: new Date(Date.now() + 1000).toISOString(),
    url: "https://x.com/author/status/100",
    type: "post",
  };
  const input: WorkflowInput = {
    name: "test",
    accountId: account.id,
    source: "user",
    usernames: ["author"],
    condition: "产品发布",
    intervalMinutes: 10,
    enabled: true,
    actions: [
      { type: "follow" },
      { type: "reply", mode: "text", text: "hello" },
      { type: "notify", content: "通知" },
    ],
  };
  const deps = {
    repository: repo,
    settings,
    x: {
      identity: (id: string) => {
        calls.push("identity:" + id);
        return { actorId: "1", cookieId: id };
      },
      home: async () => [
        {
          post,
          userId: "2",
          name: "author",
          following: false,
          followedBy: false,
        },
      ],
      follow: async () => {
        calls.push("follow");
        return { following: true, followedBy: false };
      },
      reply: async () => {
        calls.push("reply");
        return "200";
      },
      relationship: async () => ({ following: false, followedBy: false }),
    },
    timeline: async (_name: string, id: string) => {
      assert.equal(id, account.id);
      return [post];
    },
    userId: async () => "2",
    evaluateBatch: async (_condition: string, posts: SocialPost[]) => posts.map(post => ({ postId: post.id, matched: true, message: "matched" })),
    generate: async (p: string) => {
      calls.push(p);
      return "generated";
    },
    notify: async () => {
      calls.push("notify");
    },
  };
  return { db, repo, settings, input, calls, deps };
}

for (const failReply of [false, true]) test(`portrait reads start after workflow actions and keep working after ${failReply ? 'a reply failure' : 'success'}`, async () => {
  const f = fixture(), events: string[] = [], logs: TraceEntry[] = [];
  let now = 0, following = false;
  const queue = new XRequestQueue({ now: () => now, wait: async ms => { now += ms; } });
  const xCall = <T>(name: string, work: () => T) => queue.run(async () => { events.push(`${name}:${now}`); return work(); });
  const followingService = new FollowingService(new FollowingRepository(f.db), f.settings, {
    identity: f.deps.x.identity,
    profile: async () => xCall('profile', () => ({ account: { id: '2', username: 'author', name: 'Author', bio: '', fetchedAt: new Date().toISOString() }, following, followedBy: false })),
    follow: async () => xCall('follow', () => { following = true; return { following: true, followedBy: false }; }),
    unfollow: async () => { throw new Error('unexpected unfollow'); },
  }, async () => { events.push(`portrait-ai:${now}`); return { summary: '主题：工具', summaryEvidence: [] }; });
  const service = new WorkflowService({ ...f.deps,
    logger: new ExecutionLogger(entry => { logs.push(entry); if (entry.event === 'workflow.finish') events.push(`finish:${now}`); }),
    deferPortraits: followingService.deferPortraits.bind(followingService),
    x: { ...f.deps.x, home: async () => xCall('home', () => f.deps.x.home()),
      follow: followingService.follow.bind(followingService), followSkipReason: followingService.followSkipReason.bind(followingService),
      reply: async () => xCall('reply', () => { if (failReply) throw new Error('simulated rejection'); return '200'; }),
    },
    evaluateBatch: async (condition, posts) => { events.push(`match-ai:${now}`); return f.deps.evaluateBatch(condition, posts); },
    generateReply: async () => { events.push(`reply-ai:${now}`); return 'Reply'; },
  });
  const w = f.repo.save({ ...f.input, source: 'home', usernames: [], actions: [{ type: 'follow' }, { type: 'reply', mode: 'skill', elements: '' }] });
  try {
    await service.run(w.id);
    for (let i = 0; i < 20 && followingService.list(w.accountId)[0]?.summaryStatus !== 'done'; i++)
      await new Promise(resolve => setImmediate(resolve));
    assert.equal(service.runs()[0]?.status, failReply ? 'failed' : 'done');
    assert.equal(followingService.list(w.accountId)[0]?.summaryStatus, 'done');
    assert.deepEqual(events, ['home:0', 'match-ai:0', 'profile:10000', 'follow:20000', 'reply-ai:20000',
      'reply:30000', 'finish:30000', 'profile:40000', 'portrait-ai:40000']);
    assert.ok(logs.some(entry => entry.event === 'portrait.deferred'));
    assert.ok(logs.findIndex(entry => entry.event === 'portrait.start') > logs.findIndex(entry => entry.event === 'workflow.finish'));
    assert.equal(logs.find(entry => entry.event === 'portrait.done')?.context.runId, service.runs()[0]?.id);
  } finally { await service.stop(); await followingService.stop(); queue.stop(); f.db.close(); }
});

test('home filtering excludes existing follows and opt-outs before AI; repeated authors receive one new-follow reply', async () => {
  const f = fixture(), sample = (await f.deps.x.home())[0]!;
  const entries = [
    { ...sample, following: true },
    { ...sample, userId: '3', post: { ...sample.post, id: '101', author: 'optout' } },
    { ...sample, userId: '4', post: { ...sample.post, id: '102', author: 'newauthor' } },
    { ...sample, userId: '4', post: { ...sample.post, id: '103', author: 'newauthor' } },
  ];
  const analyses: string[][] = [];
  const service = new WorkflowService({ ...f.deps, x: { ...f.deps.x, home: async () => entries,
    followSkipReason: (_identity, userId) => userId === '3' ? '已取消关注' : null },
    evaluateBatch: async (condition, posts) => { analyses.push(posts.map(p => p.id)); return f.deps.evaluateBatch(condition, posts); } });
  const w = f.repo.save({ ...f.input, source: 'home', usernames: [] });
  try {
    await service.run(w.id);
    assert.deepEqual(analyses, [['102', '103']]);
    assert.deepEqual([service.runs()[0]?.scanned, service.runs()[0]?.aiMatched], [4, 2]);
    assert.deepEqual(f.calls.filter(c => ['follow', 'reply', 'notify'].includes(c)), ['follow', 'reply', 'notify']);
    assert.equal(service.runs()[0]?.matched, 1); assert.equal(service.runs()[0]?.completed, 1);
    assert.equal(f.repo.records(w.id).find(r => r.post.id === '103')?.status, 'skipped');
    assert.ok(entries.every(item => f.repo.seen(w.id, item.post.id)));
  } finally { await service.stop(); f.db.close(); }
});

test('a follow skipped after AI cannot generate a reply, count a hit or pause the workflow', async () => {
  const f = fixture();
  const service = new WorkflowService({ ...f.deps, x: { ...f.deps.x,
    follow: async () => ({ following: true, followedBy: true, created: false, skipReason: '已经关注' }) },
    generateReply: async () => { throw new Error('must not generate'); } });
  const w = f.repo.save({ ...f.input, actions: [{ type: 'follow' }, { type: 'reply', mode: 'skill' }, { type: 'notify', content: '' }] });
  try {
    await service.run(w.id);
    const run = service.runs()[0]!;
    assert.deepEqual([run.status, run.checked, run.matched, run.completed], ['done', 1, 0, 0]);
    assert.deepEqual([run.scanned, run.aiMatched], [1, 1]);
    assert.deepEqual(f.repo.records(w.id)[0]?.actions.map(a => a.status), ['skipped', 'skipped', 'skipped']);
    assert.equal(f.repo.get(w.id)?.enabled, true); assert.ok(!f.calls.includes('reply')); assert.ok(!f.calls.includes('notify'));
  } finally { await service.stop(); f.db.close(); }
});

test('concurrent workflows share tracked follow ownership and only its creator replies', async () => {
  const f = fixture(), followingRepo = new FollowingRepository(f.db);
  let following = false, followWrites = 0;
  const social = { identity: f.deps.x.identity,
    profile: async () => ({ account: { id: '2', username: 'author', name: 'Author', bio: '', fetchedAt: '' }, following, followedBy: false }),
    follow: async () => { following = true; followWrites++; return { following, followedBy: false }; },
    unfollow: async () => ({ following: false, followedBy: false }),
  };
  const tracked = new FollowingService(followingRepo, f.settings, social, async () => ({ summary: 'portrait', summaryEvidence: [] }));
  const service = new WorkflowService({ ...f.deps, x: { ...f.deps.x, follow: tracked.follow.bind(tracked), followSkipReason: tracked.followSkipReason.bind(tracked) } });
  const one = f.repo.save(f.input), two = f.repo.save(f.input);
  try {
    await Promise.all([service.run(one.id), service.run(two.id)]);
    assert.equal(followWrites, 1); assert.equal(f.calls.filter(c => c === 'reply').length, 1);
    assert.equal(service.runs().reduce((sum, r) => sum + r.matched, 0), 1);
    assert.equal(f.repo.records(one.id).concat(f.repo.records(two.id)).filter(r => r.status === 'done').length, 1);
  } finally { await service.stop(); await tracked.stop(); f.db.close(); }
});

test('manual opt-out while a reply waits in the X queue cancels it before sending or consuming quota', async () => {
  const f = fixture(); let optedOut = false, now = 0, consumed = 0;
  const queue = new XRequestQueue({ now: () => now, wait: async ms => { now += ms; optedOut = true; } });
  const service = new WorkflowService({ ...f.deps, x: { ...f.deps.x,
    followSkipReason: () => optedOut ? '关注列表记录为已取消关注' : null,
    follow: async () => queue.run(f.deps.x.follow),
    reply: async () => queue.run(f.deps.x.reply, () => { consumed++; }),
  } });
  const w = f.repo.save(f.input);
  try {
    await service.run(w.id);
    assert.equal(consumed, 0); assert.ok(!f.calls.includes('reply'));
    assert.deepEqual(f.repo.records(w.id)[0]?.actions.map(a => a.status), ['done', 'skipped', 'skipped']);
    assert.equal(service.runs()[0]?.status, 'done'); assert.equal(service.runs()[0]?.matched, 1); assert.equal(service.runs()[0]?.completed, 0);
  } finally { await service.stop(); queue.stop(); f.db.close(); }
});

test('deferred replies require persisted proof of a new follow and respect a later manual opt-out', async () => {
  for (const optOut of [true, false]) {
    const f = fixture(); let limited = true, cancelled = false;
    const deps = { ...f.deps, x: { ...f.deps.x,
      followSkipReason: () => cancelled ? '已取消关注' : null,
      reply: async () => { if (limited) throw new AccountRequestLimitError('test', 'reply', 1, 1, '2099-01-01'); return f.deps.x.reply(); },
    } };
    let service = new WorkflowService(deps); const w = f.repo.save(f.input);
    try {
      await service.run(w.id);
      const record = f.repo.pending(w.id)[0]!; assert.equal(record.actions[0]?.newlyFollowed, true);
      if (optOut) cancelled = true;
      else { delete record.actions[0]!.newlyFollowed; record.actions[0]!.result = '已经关注'; f.repo.record(record); }
      await service.stop(); service = new WorkflowService(deps); limited = false;
      await service.run(w.id, true);
      assert.equal(f.repo.pending(w.id).length, 0); assert.equal(f.repo.records(w.id)[0]?.status, 'skipped');
      assert.ok(!f.calls.includes('reply')); assert.equal(service.runs()[0]?.matched, 1); // Original new follow remains part of this round.
    } finally { await service.stop(); f.db.close(); }
  }
});
test("workflow preview never executes actions; ordered execution is deduplicated across restarts", async () => {
  const f = fixture(),
    service = new WorkflowService(f.deps),
    w = f.repo.save(f.input);
  assert.equal((await service.preview(w))[0]?.matched, true);
  assert.ok(!f.calls.includes("follow"));
  await Promise.all([service.run(w.id), service.run(w.id)]);
  assert.deepEqual(
    f.calls.filter((c) => ["follow", "reply", "notify"].includes(c)),
    ["follow", "reply", "notify"]
  );
  assert.equal(f.repo.records(w.id)[0]?.status, "done");
  await new WorkflowService(f.deps).run(w.id);
  assert.equal(f.calls.filter((c) => c === "reply").length, 1);
  f.db.close();
});
test('home listeners send all eligible posts together and map shuffled AI results back to the right actions', async () => {
  const f = fixture();
  const sample = (await f.deps.x.home())[0]!;
  const entries = Array.from({ length: 20 }, (_, i) => ({ ...sample, post: { ...sample.post, id: String(200 + i), author: `author${i}` } }));
  const old = { ...sample, post: { ...sample.post, id: 'old', createdAt: '2020-01-01T00:00:00Z' } };
  const seen = { ...sample, post: { ...sample.post, id: 'seen' } };
  const generated: string[] = [], sent: string[] = [];
  let requests = 0;
  const w = f.repo.save({ ...f.input, source: 'home', usernames: [], actions: [{ type: 'reply', mode: 'skill', elements: '' }] });
  f.repo.markSeen(w.id, 'seen');
  const service = new WorkflowService({ ...f.deps,
    x: { ...f.deps.x, home: async identity => {
      assert.equal(identity.cookieId, w.accountId); return [old, seen, ...entries, entries[0]!];
    }, reply: async (_identity, postId) => { sent.push(postId); return '900'; } },
    evaluateBatch: async (condition, posts) => {
      requests++; assert.equal(condition, w.condition);
      assert.deepEqual(posts.map(post => post.id), [old, ...entries].map(item => item.post.id));
      assert.deepEqual(sent, []);
      return [...posts].reverse().map(post => ({ postId: post.id, matched: ['203', '211'].includes(post.id), message: '符合条件 ' + post.id }));
    },
    generateReply: async (_id, post) => { generated.push(post.id); return 'Reply ' + post.id; },
  });
  try {
    await service.run(w.id);
    assert.equal(requests, 1); assert.deepEqual(sent, ['203', '211']); assert.deepEqual(generated, sent);
    assert.deepEqual(service.runs().map(run => [run.status, run.checked, run.matched, run.completed]), [['done', 21, 2, 2]]);
    assert.ok(f.repo.records(w.id).every(record => record.reason === '符合条件 ' + record.post.id));
    assert.ok([...entries, old].every(item => f.repo.seen(w.id, item.post.id)));
    await service.run(w.id); assert.equal(requests, 1); assert.equal(sent.length, 2);
  } finally { await service.stop(); f.db.close(); }
});
test('live batch progress reports all AI decisions before actions and retains counts when a later action fails', async () => {
  const f = fixture(), sample = (await f.deps.x.home())[0]!;
  const entries = Array.from({ length: 35 }, (_, i) => ({ ...sample, post: { ...sample.post, id: String(300 + i) } }));
  let releaseAI!: () => void, aiStarted!: () => void, releaseAction!: () => void, actionStarted!: () => void;
  const aiGate = new Promise<void>(resolve => { releaseAI = resolve; }), aiReady = new Promise<void>(resolve => { aiStarted = resolve; });
  const actionGate = new Promise<void>(resolve => { releaseAction = resolve; }), actionReady = new Promise<void>(resolve => { actionStarted = resolve; });
  let aiCalls = 0;
  const matcher = new WorkflowMatcher({ async complete(_provider, messages) {
    if (++aiCalls === 1) { aiStarted(); await aiGate; }
    const items = JSON.parse(messages[1]!.content).posts;
    return JSON.stringify({ matches: items.filter((post: { postId: string }) => ['300', '334'].includes(post.postId)).map((post: { postId: string }) => ({ postId: post.postId, message: 'test' })) });
  } } as AIGateway);
  const service = new WorkflowService({ ...f.deps, x: { ...f.deps.x, home: async () => entries },
    evaluateBatch: (condition, posts, ensureCurrent, report) => matcher.evaluate(condition, posts, ensureCurrent, report),
    notify: async (_text, post) => { if (post.id === '300') { actionStarted(); await actionGate; } else throw new Error('simulated action failure'); } });
  const w = f.repo.save({ ...f.input, source: 'home', usernames: [], actions: [{ type: 'notify', content: '' }] });
  const running = service.run(w.id);
  try {
    await aiReady;
    assert.deepEqual(service.runs()[0]?.batch, { index: 1, total: 30, checked: 0, matched: 0, completed: 0 });
    assert.equal(service.runs()[0]?.phase, 'analyze');
    assert.deepEqual([service.runs()[0]?.scanned, service.runs()[0]?.aiMatched], [35, 0]);
    releaseAI(); await actionReady;
    const snapshot = service.runs()[0]!;
    assert.equal(aiCalls, 2); assert.equal(snapshot.phase, 'actions');
    assert.deepEqual([snapshot.checked, snapshot.matched, snapshot.completed], [35, 2, 0]);
    assert.deepEqual([snapshot.scanned, snapshot.aiMatched], [35, 2]);
    assert.deepEqual(snapshot.batch, { index: 1, total: 30, checked: 30, matched: 1, completed: 0 });
    releaseAction(); await running;
    const failed = service.runs()[0]!;
    assert.equal(failed.status, 'failed'); assert.deepEqual([failed.checked, failed.matched, failed.completed], [35, 2, 1]);
    assert.deepEqual(failed.batch, { index: 2, total: 5, checked: 5, matched: 1, completed: 0 });
    assert.equal(snapshot.completed, 0); assert.equal(snapshot.batch?.completed, 0);
  } finally { releaseAI(); releaseAction(); await service.stop(); f.db.close(); }
});
test('a failed later home batch advances no progress and executes no partial actions; retry handles the whole page', async () => {
  const f = fixture(), sample = (await f.deps.x.home())[0]!;
  const entries = Array.from({ length: 35 }, (_, i) => ({ ...sample, post: { ...sample.post, id: String(300 + i) } }));
  let fail = true, requests = 0;
  const matcher = new WorkflowMatcher({ async complete(_provider, messages) {
    requests++;
    const input = JSON.parse(messages[1]!.content);
    return fail && requests === 2 ? '{"matches":[' : JSON.stringify({ matches: input.posts.map((post: { postId: string }) => ({ postId: post.postId, message: '发布了产品' })) });
  } } as AIGateway);
  const service = new WorkflowService({ ...f.deps, x: { ...f.deps.x, home: async () => entries },
    evaluateBatch: (condition, posts, ensureCurrent) => matcher.evaluate(condition, posts, ensureCurrent) });
  const w = f.repo.save({ ...f.input, source: 'home', usernames: [], actions: [{ type: 'notify', content: '' }] });
  try {
    await service.run(w.id);
    assert.equal(requests, 2); assert.equal(service.runs()[0]?.status, 'failed');
    assert.match(service.runs()[0]!.error!, /不是有效 JSON/); assert.equal(f.repo.get(w.id)?.enabled, true);
    assert.equal(f.repo.get(w.id)?.lastSeenPostId, w.lastSeenPostId);
    assert.deepEqual(f.repo.records(w.id), []); assert.ok(!f.calls.includes('notify'));
    assert.ok(entries.every(item => !f.repo.seen(w.id, item.post.id)));
    fail = false; await service.run(w.id);
    assert.equal(requests, 4); assert.equal(service.runs()[0]?.completed, 35); assert.equal(f.repo.records(w.id).length, 35);
  } finally { await service.stop(); f.db.close(); }
});
test('226 during the third reply retains batch counts and completed follows, pauses, and never resends claimed posts', async () => {
  const f = fixture(), sample = (await f.deps.x.home())[0]!;
  const entries = Array.from({ length: 18 }, (_, i) => ({ ...sample, userId: String(20 + i),
    post: { ...sample.post, id: String(300 + i), author: `author${i}` } }));
  const requests: string[] = [];
  const logs: TraceEntry[] = [];
  const logger = new ExecutionLogger(entry => logs.push(structuredClone(entry)));
  let analyses = 0;
  const client = new OutreachXClient(f.settings, new XRequestQueue({ intervalMs: 0 }), logger.fetch('X', async (url, options) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith('/friendships/create.json')) {
      const id = new URLSearchParams(String(options?.body)).get('user_id');
      requests.push(`follow:${id}`);
      return Response.json({ id_str: id, following: true });
    }
    assert.ok(path.endsWith('/CreateTweet'));
    const id = JSON.parse(String(options?.body)).variables.reply.in_reply_to_tweet_id;
    requests.push(`reply:${id}`);
    return id === '302'
      ? Response.json({ data: {}, errors: [{ code: 226 }] })
      : Response.json({ data: { create_tweet: { tweet_results: { result: { rest_id: '900' + id } } } } });
  }));
  const deps = { ...f.deps, logger, x: { ...f.deps.x, home: async () => entries,
    follow: client.follow.bind(client), reply: client.reply.bind(client) },
    evaluateBatch: async (_condition: string, posts: SocialPost[]) => {
      analyses++;
      return posts.map(post => ({ postId: post.id, matched: Number(post.id) < 306, message: 'match' }));
    } };
  const w = f.repo.save({ ...f.input, source: 'home', usernames: [] });
  let service = new WorkflowService(deps);
  try {
    await service.run(w.id);
    assert.equal(analyses, 1);
    assert.deepEqual(requests, ['follow:20', 'reply:300', 'follow:21', 'reply:301', 'follow:22', 'reply:302']);
    const run = service.runs()[0]!;
    assert.deepEqual([run.status, run.checked, run.matched, run.completed], ['failed', 18, 3, 2]);
    assert.deepEqual([run.scanned, run.aiMatched], [18, 6]);
    assert.deepEqual(run.batch, { index: 1, total: 18, checked: 18, matched: 3, completed: 2 });
    const failure = logs.find(entry => entry.event === 'http.response' && String(entry.data.responseBody).includes('226'))!;
    const sent = logs.find(entry => entry.event === 'http.request' && entry.context.requestId === failure.context.requestId)!;
    assert.match(String(sent.data.curl), /in_reply_to_tweet_id.*302/);
    assert.equal(sent.context.runId, run.id); assert.equal(sent.context.postId, '302');
    assert.equal(failure.data.status, 200);
    assert.equal(logs.at(-1)?.event, 'workflow.finish');
    assert.equal(logs.at(-1)?.data.status, 'failed'); assert.equal(logs.at(-1)?.data.aiMatched, 6);
    assert.match(run.error!, /回复 @author2（Post 302）失败.*代码 226.*自动化或垃圾内容.*不会自动重发/);
    const record = f.repo.records(w.id).find(r => r.post.id === '302')!;
    assert.deepEqual(record.actions.map(step => step.status), ['done', 'uncertain', 'pending']);
    assert.equal(record.actions[1]?.result, run.error);
    assert.equal(f.calls.filter(call => call === 'notify').length, 2);
    assert.equal(f.repo.get(w.id)?.enabled, false);
    assert.equal(f.repo.get(w.id)?.lastError, run.error);
    assert.equal(f.repo.get(w.id)?.lastSeenPostId, w.lastSeenPostId);
    assert.ok(f.repo.seen(w.id, '302'));
    assert.ok(f.repo.seen(w.id, '303')); // Claimed with the durable queue, still pending action.
    assert.deepEqual(f.repo.pending(w.id).map(r => r.post.id), ['303', '304', '305']);
    await service.stop();
    service = new WorkflowService(deps);
    await service.tick();
    assert.equal(requests.length, 6); // Restart cannot resume a paused workflow.
    f.repo.save({ ...w, enabled: true }, w.id);
    await service.run(w.id);
    for (const sent of ['follow:20', 'reply:300', 'follow:21', 'reply:301', 'follow:22', 'reply:302'])
      assert.equal(requests.filter(request => request === sent).length, 1);
    assert.equal(f.repo.records(w.id).find(entry => entry.id === record.id)?.status, 'uncertain');
  } finally { await service.stop(); f.db.close(); }
});
test("workflow reply Skill receives its account and target; preview never generates or replies", async () => {
  const f = fixture();
  try {
    const input = validateWorkflow({ ...f.input, actions: [{ type: 'reply', mode: 'skill', instructions: '简洁', input: '我赞同', targetLanguage: 'en' }] }, f.settings);
    const service = new WorkflowService({ ...f.deps, generateReply: async (accountId, post, action) => {
      assert.equal(accountId, f.input.accountId); assert.equal(post.id, '100'); assert.equal(action.elements, '简洁\n\n我赞同');
      f.calls.push('skill'); return 'A useful point.';
    } });
    const w = f.repo.save(input);
    await service.preview(w); assert.ok(!f.calls.includes('skill')); assert.ok(!f.calls.includes('reply'));
    await service.run(w.id);
    assert.deepEqual(f.calls.filter(c => ['skill', 'reply'].includes(c)), ['skill', 'reply']);
    assert.equal(f.repo.records(w.id)[0]?.status, 'done');
  } finally { f.db.close(); }
});
test("ambiguous external failure pauses workflow and does not repeat a successful follow or failed reply", async () => {
  const f = fixture();
  f.deps.x.reply = async () => {
    f.calls.push("reply");
    throw new Error("connection reset");
  };
  const service = new WorkflowService(f.deps),
    w = f.repo.save(f.input);
  await service.run(w.id);
  assert.equal(f.repo.get(w.id)?.enabled, false);
  assert.equal(f.repo.records(w.id)[0]?.status, "uncertain");
  assert.ok(!f.calls.includes("notify"));
  f.repo.save({ ...f.input, enabled: true }, w.id);
  await service.run(w.id);
  assert.equal(f.calls.filter((c) => c === "reply").length, 1);
  f.db.close();
});
test('a stale follow response is verified before subsequent workflow actions; unavailable confirmation never queues another follow', async () => {
  for (const blockedConfirmation of [false, true]) {
    const f = fixture(), requests: string[] = [];
    if (blockedConfirmation) f.settings.configuration.requestLimits.save(f.input.accountId, { ...DEFAULT_ACCOUNT_DAILY_LIMITS, profile: 0 });
    const x = new OutreachXClient(f.settings, new XRequestQueue({ intervalMs: 0 }), async (url, options) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith('/friendships/create.json')) {
        assert.equal(options?.method, 'POST'); requests.push('follow');
        return Response.json({ id_str: '2', following: false });
      }
      if (path.endsWith('/UserByScreenName')) {
        assert.equal(options?.method, 'GET'); requests.push('confirm');
        return Response.json({ data: { user: { result: { rest_id: '2', relationship_perspectives: { following: true } } } } });
      }
      if (path.endsWith('/CreateTweet')) {
        assert.deepEqual(requests, ['follow', 'confirm']); requests.push('reply');
        return Response.json({ data: { create_tweet: { tweet_results: { result: { rest_id: '200' } } } } });
      }
      throw new Error('Unexpected request');
    });
    const w = f.repo.save(f.input), service = new WorkflowService({ ...f.deps, x });
    try {
      await service.run(w.id);
      const record = f.repo.records(w.id)[0]!;
      assert.deepEqual(requests, blockedConfirmation ? ['follow'] : ['follow', 'confirm', 'reply']);
      assert.equal(record.status, blockedConfirmation ? 'uncertain' : 'done');
      assert.equal(f.repo.get(w.id)?.enabled, !blockedConfirmation);
      assert.equal(f.repo.pending(w.id).length, 0);
      assert.equal(f.calls.includes('notify'), !blockedConfirmation);
      await service.run(w.id, true);
      assert.equal(requests.filter(request => request === 'follow').length, 1);
    } finally { await service.stop(); f.db.close(); }
  }
});
test('daily quota defers only unsent actions and resumes them after restart without repeating completed actions', async () => {
  const f = fixture(), quota = new AccountRequestLimits(f.db);
  quota.save(f.input.accountId, { ...DEFAULT_ACCOUNT_DAILY_LIMITS, follow: 1, reply: 1 });
  quota.consume(f.input.accountId, 'reply'); // The account used its reply allowance in another task.
  f.deps.x.follow = async () => { quota.consume(f.input.accountId, 'follow'); f.calls.push('follow'); return { following: true, followedBy: false }; };
  f.deps.x.reply = async () => { quota.consume(f.input.accountId, 'reply'); f.calls.push('reply'); return '200'; };
  const w = f.repo.save(f.input); let service = new WorkflowService(f.deps);
  try {
    await service.run(w.id);
    assert.equal(service.runs()[0]?.status, 'limited'); assert.equal(f.repo.get(w.id)?.enabled, true);
    assert.ok(Date.parse(f.repo.get(w.id)!.retryAt!) > Date.now());
    const pending = f.repo.pending(w.id)[0]!;
    assert.deepEqual(pending.actions.map(a => a.status), ['done', 'pending', 'pending']);
    assert.equal(f.calls.filter(c => c === 'follow').length, 1); assert.ok(!f.calls.includes('reply'));
    await service.stop(); service = new WorkflowService(f.deps);
    await service.tick(); assert.equal(f.repo.pending(w.id).length, 1); assert.equal(service.runs()[0]?.status, 'limited');
    // Increasing the allowance permits an explicit run immediately; the daily reset follows the same quota path.
    quota.save(f.input.accountId, { ...DEFAULT_ACCOUNT_DAILY_LIMITS, follow: 1, reply: 2 });
    await service.run(w.id, true);
    assert.deepEqual(f.calls.filter(c => ['follow', 'reply', 'notify'].includes(c)), ['follow', 'reply', 'notify']);
    assert.equal(f.repo.records(w.id).length, 1); assert.equal(f.repo.records(w.id)[0]?.id, pending.id);
    assert.equal(f.repo.records(w.id)[0]?.status, 'done'); assert.equal(f.repo.get(w.id)?.retryAt, null);
    assert.equal(f.repo.pending(w.id).length, 0); assert.equal(quota.view(w.accountId).used.follow, 1);
  } finally { await service.stop(); f.db.close(); }
});
test('a quota-limited read leaves posts untouched and an edited workflow cannot resume stale deferred actions', async () => {
  const f = fixture(), quota = f.settings.configuration.requestLimits;
  const w = f.repo.save(f.input);
  f.deps.timeline = async () => { throw new AccountRequestLimitError('账号', 'posts', 1, 1, new Date(Date.now() + 3600000).toISOString()); };
  let service = new WorkflowService(f.deps);
  try {
    await service.run(w.id);
    assert.equal(service.runs()[0]?.status, 'limited'); assert.deepEqual(f.repo.records(w.id), []);
    assert.equal(f.repo.seen(w.id, '100'), false); assert.equal(f.repo.get(w.id)?.enabled, true);
    await service.stop();
    f.deps.timeline = async () => [(await f.deps.x.home())[0]!.post];
    quota.save(w.accountId, { ...DEFAULT_ACCOUNT_DAILY_LIMITS, reply: 0 });
    f.deps.x.reply = async () => { quota.consume(w.accountId, 'reply'); f.calls.push('reply'); return '200'; };
    service = new WorkflowService(f.deps); await service.run(w.id, true);
    assert.equal(f.repo.pending(w.id).length, 1);
    f.repo.save({ ...w, actions: [{ type: 'reply', mode: 'text', text: 'changed reply' }] }, w.id);
    quota.save(w.accountId, DEFAULT_ACCOUNT_DAILY_LIMITS);
    await service.run(w.id, true);
    assert.equal(f.repo.pending(w.id).length, 0); assert.ok(!f.calls.includes('reply'));
    assert.ok(f.repo.records(w.id)[0]?.actions.some(action => action.result?.includes('编排已修改')));
  } finally { await service.stop(); f.db.close(); }
});
test("a restart pauses interrupted work and template replies interpolate all variables", async () => {
  const f = fixture(),
    prompt = f.settings.configuration.savePrompt({
      name: "回复",
      scene: "reply",
      prompt: "{input}|{reply}|{{_tl_}}",
      accountIds: [],
    });
  const w = f.repo.save({
    ...f.input,
    actions: [
      {
        type: "reply",
        mode: "prompt",
        promptId: prompt.id,
        input: "my view",
        targetLanguage: "en",
      },
    ],
  });
  await new WorkflowService({ ...f.deps, generateReply: async (_accountId, _post, action) => { f.calls.push(action.elements ?? ''); return 'generated'; } }).run(w.id);
  assert.ok(f.calls.includes("my view|launch|zh-CN"));
  const record = f.repo.records(w.id)[0]!;
  record.status = "running";
  record.actions[0]!.status = "running";
  f.repo.record(record);
  new WorkflowService(f.deps);
  assert.equal(f.repo.get(w.id)?.enabled, false);
  assert.equal(f.repo.records(w.id)[0]?.status, "uncertain");
  f.db.close();
});
test("invalid workflow references, sources and intervals are rejected", () => {
  const f = fixture();
  assert.throws(() =>
    validateWorkflow({ ...f.input, accountId: "missing" }, f.settings)
  );
  assert.throws(() =>
    validateWorkflow({ ...f.input, intervalMinutes: 0 }, f.settings)
  );
  assert.throws(() =>
    validateWorkflow({ ...f.input, source: "user", usernames: [] }, f.settings)
  );
  assert.throws(() =>
    validateWorkflow(
      {
        ...f.input,
        actions: [
          {
            type: "reply",
            mode: "prompt",
            promptId: "missing",
            input: "",
            targetLanguage: "en",
          },
        ],
      },
      f.settings
    )
  );
  f.db.close();
});
test('random is the default, empty actions can be saved while paused, and home requires an account', async () => {
  const f = fixture();
  try {
    const input = validateWorkflow({ ...f.input, accountId: undefined, enabled: false, actions: [] }, f.settings);
    assert.equal(input.accountId, RANDOM_WORKFLOW_ACCOUNT); assert.deepEqual(input.actions, []);
    assert.throws(() => validateWorkflow({ ...input, enabled: true }, f.settings), /至少添加一个/);
    assert.throws(() => validateWorkflow({ ...input, source: 'home' }, f.settings), /首页监听需要指定账号/);
    const skill = validateWorkflow({ ...input, actions: [{ type: 'reply', mode: 'skill' }] }, f.settings).actions[0];
    assert.deepEqual(skill, { type: 'reply', mode: 'skill', elements: '' });
    assert.throws(() => validateWorkflow({ ...input, actions: [{ type: 'reply', mode: 'skill', elements: 42 }] }, f.settings), /回复要素/);
    const w = f.repo.save(input), service = new WorkflowService(f.deps);
    await service.run(w.id, true);
    assert.equal(service.runs()[0]?.status, 'failed'); assert.deepEqual(f.calls, []); assert.deepEqual(f.repo.records(w.id), []);
  } finally { f.db.close(); }
});
test('one random actor is retained through every target, generation and action and recorded in history', async () => {
  const f = fixture();
  try {
    const second = f.settings.configuration.saveAccount({ name: '第二账号', username: 'second', cookie: 'auth_token=second; ct0=csrf; twid=u%3D2', profile: { primaryLanguage: 'English', description: 'Be specific.' } });
    const invalid = f.settings.configuration.saveAccount({ name: '失效', username: 'invalid', cookie: 'auth_token=invalid; ct0=csrf; twid=u%3D3' });
    f.settings.configuration.updateCookieStatus(invalid.id, 'auth_token=invalid; ct0=csrf; twid=u%3D3', 'invalid');
    f.settings.configuration.saveAccount({ name: '无身份', username: 'unknown', cookie: 'auth_token=unknown; ct0=csrf' });
    let selections = 0;
    const actors: string[] = [];
    const service = new WorkflowService({ ...f.deps, random: () => { selections++; return 0.99; },
      timeline: async (name, id) => { actors.push(id); return [{ platform: 'x', id: name === 'one' ? '200' : '201', author: name, text: name, createdAt: new Date(Date.now() + 1000).toISOString(), url: `https://x.com/${name}/status/${name === 'one' ? '200' : '201'}`, type: 'post' }]; },
      userId: async (_name, id) => { actors.push(id); return '9'; },
      generateReply: async (id) => { actors.push(id); assert.equal(f.settings.configuration.profile(id).primaryLanguage, 'English'); return 'A specific reply.'; },
      x: { ...f.deps.x, identity: id => ({ cookieId: id, actorId: '2' }),
        follow: async identity => { actors.push(identity.cookieId); return { following: true, followedBy: false }; },
        reply: async identity => { actors.push(identity.cookieId); return '300'; } },
    });
    const w = f.repo.save({ ...f.input, accountId: RANDOM_WORKFLOW_ACCOUNT, usernames: ['one'], actions: [{ type: 'follow' }, { type: 'reply', mode: 'skill', elements: '' }, { type: 'notify', content: '' }] });
    await service.run(w.id);
    assert.equal(selections, 1); assert.equal(actors.length, 5); assert.ok(actors.every(id => id === second.id));
    assert.equal(service.runs()[0]?.accountId, second.id); assert.equal(service.runs()[0]?.completed, 1);
    assert.ok(f.repo.records(w.id).every(r => r.accountId === second.id && r.accountName === '第二账号'));
    assert.equal(f.repo.get(w.id)?.accountId, RANDOM_WORKFLOW_ACCOUNT);
  } finally { f.db.close(); }
});
test('no usable random account fails before fetching or performing actions', async () => {
  const f = fixture();
  try {
    f.settings.configuration.updateCookieStatus(f.input.accountId, 'auth_token=secret; ct0=csrf; twid=u%3D1', 'invalid');
    const service = new WorkflowService(f.deps), w = f.repo.save({ ...f.input, accountId: RANDOM_WORKFLOW_ACCOUNT });
    await service.run(w.id);
    assert.deepEqual(f.calls, []); assert.equal(service.runs()[0]?.status, 'failed');
    assert.match(service.runs()[0]!.error!, /没有可用/); assert.deepEqual(f.repo.records(w.id), []);
  } finally { f.db.close(); }
});

test("old listener conditions and outreach actions are retained as inactive workflows only once", () => {
  const db = openDatabase(":memory:");
  const settings = new SettingsRepository(db);
  const account = settings.configuration.saveAccount({
    name: "Main",
    username: "main",
    cookie: "auth_token=a; ct0=b; twid=u%3D10",
    configIds: [],
  });
  db.prepare(
    `INSERT INTO monitors (id,name,platform,username,prompt,interval_minutes,enabled,created_at,updated_at) VALUES ('old','Old rule','x','author','launches',15,1,'2026-01-01','2026-01-01')`
  ).run();
  db.prepare("INSERT INTO outreach_accounts VALUES (?,?,?)").run(
    "old-outreach",
    "10",
    JSON.stringify({
      name: "Follow rule",
      cookieId: account.id,
      prompt: "invites",
      replyText: "hello",
      intervalMinutes: 60,
      enabled: true,
    })
  );
  const repo = new WorkflowRepository(db);
  assert.equal(repo.list().length, 2);
  assert.ok(repo.list().every((w) => !w.enabled && w.accountId === account.id));
  assert.deepEqual(
    repo.list()[1]!.actions.map((a) => a.type),
    ["follow", "reply"]
  );
  for (const w of repo.list()) repo.remove(w.id);
  assert.deepEqual(new WorkflowRepository(db).list(), []);
  db.close();
});

test("a follow that is not confirmed stops the following reply", async () => {
  const f = fixture();
  f.deps.x.follow = async () => ({ following: false, followedBy: false });
  const w = f.repo.save(f.input);
  await new WorkflowService(f.deps).run(w.id);
  assert.equal(f.repo.get(w.id)?.enabled, false);
  assert.ok(!f.calls.includes("reply"));
  f.db.close();
});

test("run once includes old unseen posts while paused and deduplicates subsequent runs", async () => {
  const f = fixture();
  const timeline = f.deps.timeline;
  f.deps.timeline = async (name, id) => {
    const [post] = await timeline(name, id);
    return [{ ...post!, id: "old", createdAt: "2020-01-01T00:00:00Z" }, post!];
  };
  const w = f.repo.save({ ...f.input, enabled: false });
  const service = new WorkflowService(f.deps);
  try {
    await service.tick();
    assert.deepEqual(f.calls, []);
    const run = service.runOnce(w.id)!;
    assert.equal(run.status, "running");
    await service.run(w.id); // Joins the same in-flight execution.
    assert.equal(f.repo.get(w.id)?.enabled, false);
    assert.deepEqual(f.calls.filter(c => ["follow", "reply", "notify"].includes(c)), ["follow", "reply", "notify"]);
    assert.deepEqual(service.runs().map(r => [r.status, r.checked, r.matched, r.completed]), [["done", 2, 1, 1]]);
    assert.ok(service.runs()[0]?.finishedAt);
    assert.equal(f.repo.records(w.id).filter(record => record.status === 'done').length, 1);
    assert.ok(f.repo.records(w.id).some(record => record.post.id === 'old' && record.status === 'done'));
    await service.tick();
    service.runOnce(w.id);
    await service.run(w.id);
    assert.equal(service.runs()[0]?.checked, 0);
    assert.equal(f.calls.filter(c => c === "reply").length, 1);
  } finally { await service.stop(); f.db.close(); }
});

test("manual and scheduled requests share one execution, including while evaluation is pending", async () => {
  const f = fixture();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  f.deps.evaluateBatch = async (_condition, posts) => { await gate; return posts.map(post => ({ postId: post.id, matched: true, message: "matched" })); };
  const w = f.repo.save(f.input), service = new WorkflowService(f.deps);
  try {
    const scheduled = service.tick();
    const first = service.runOnce(w.id)!;
    assert.equal(service.runOnce(w.id)?.id, first.id);
    release();
    await scheduled;
    assert.equal(f.calls.filter(c => c === "reply").length, 1);
    assert.equal(f.repo.get(w.id)?.enabled, true);
    assert.equal(service.runs()[0]?.status, "done");
  } finally { release(); await service.stop(); f.db.close(); }
});

test("run once reports external failure and does not retry an uncertain action", async () => {
  const f = fixture();
  f.deps.x.reply = async () => { f.calls.push("reply"); throw new Error("connection reset"); };
  const w = f.repo.save({ ...f.input, enabled: false }), service = new WorkflowService(f.deps);
  try {
    service.runOnce(w.id);
    await service.run(w.id);
    assert.equal(service.runs()[0]?.status, "failed");
    assert.match(service.runs()[0]!.error!, /回复 @author（Post 100）失败：connection reset.*已暂停后续动作，不会自动重发/);
    assert.equal(service.runs()[0]?.completed, 0);
    assert.equal(f.repo.records(w.id)[0]?.status, "uncertain");
    assert.ok(!f.calls.includes("notify"));
    service.runOnce(w.id);
    await service.run(w.id);
    assert.equal(f.calls.filter(c => c === "reply").length, 1);
  } finally { await service.stop(); f.db.close(); }
});

test("editing or deleting a paused workflow during manual evaluation cancels its actions", async () => {
  for (const mutation of ["edit", "delete"] as const) {
    const f = fixture(), w = f.repo.save({ ...f.input, enabled: false });
    f.deps.evaluateBatch = async (_condition, posts) => {
      if (mutation === "edit") f.repo.save({ ...w, condition: "different", enabled: true }, w.id);
      else f.repo.remove(w.id);
      return posts.map(post => ({ postId: post.id, matched: true, message: "matched" }));
    };
    const service = new WorkflowService(f.deps);
    try {
      service.runOnce(w.id);
      await service.run(w.id);
      assert.ok(!f.calls.some(c => ["follow", "reply", "notify"].includes(c)));
      assert.deepEqual(f.repo.records(w.id), []);
      if (mutation === "edit") {
        assert.equal(service.runs()[0]?.status, "cancelled");
        assert.equal(f.repo.get(w.id)?.enabled, true);
      } else assert.deepEqual(service.runs(), []);
    } finally { await service.stop(); f.db.close(); }
  }
});

test("manual run endpoints return promptly, expose progress, and reject missing or stopping workflows", async () => {
  const f = fixture(), app = Fastify();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  f.deps.evaluateBatch = async (_condition, posts) => { await gate; return posts.map(post => ({ postId: post.id, matched: false, message: "skip" })); };
  const service = new WorkflowService(f.deps), w = f.repo.save({ ...f.input, enabled: false });
  registerWorkflowRoutes(app, f.repo, service, f.settings);
  try {
    const response = await app.inject({ method: "POST", url: `/api/workflows/${w.id}/run` });
    assert.equal(response.statusCode, 202);
    assert.equal(response.json().data.status, "running");
    const second = await app.inject({ method: "POST", url: `/api/workflows/${w.id}/run` });
    assert.equal(second.json().data.id, response.json().data.id);
    assert.equal((await app.inject("/api/workflows/runs")).json().data[0].status, "running");
    assert.equal((await app.inject({ method: "POST", url: "/api/workflows/missing/run" })).statusCode, 404);
    release();
    await service.run(w.id);
    const result = (await app.inject("/api/workflows/runs")).json().data[0];
    assert.equal(result.status, "done");
    assert.equal(result.checked, 1);
    assert.equal(result.matched, 0);
    assert.ok(!f.calls.includes("reply"));
    await service.stop();
    assert.equal((await app.inject({ method: "POST", url: `/api/workflows/${w.id}/run` })).statusCode, 503);
  } finally { release(); await service.stop(); await app.close(); f.db.close(); }
});


for (const failure of ['missing_end', 'malformed', 'disconnect'] as const) test(`streamed home judgments wait for completion and preserve progress on ${failure}`, async () => {
  const f = fixture(), received = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  let broken = true, requests = 0;
  f.settings.update({ai: {defaultProvider: 'fixture:model', services: [{id: 'fixture', name: 'Fixture', endpoint: 'https://fixture.invalid/chat', apiKey: 'test', models: [{name: 'model'}], enabled: true}]}});
  const client = new OpenAICompatibleClient(async (_url, init) => {
    requests++;
    const body = JSON.parse(String(init?.body)); assert.equal(body.stream, true);
    const posts = JSON.parse(body.messages[1].content).posts;
    const content = JSON.stringify({matches: posts.map((p: {postId: string}) => ({postId: p.postId, message: '命中'}))});
    const encoder = new TextEncoder();
    return new Response(new ReadableStream({start(c) {
      c.enqueue(encoder.encode(`data: ${JSON.stringify({choices: [{delta: {content}}]})}\n\n`));
      received.resolve();
      void release.promise.then(() => {
        if (!broken) c.enqueue(encoder.encode('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'));
        else if (failure === 'malformed') c.enqueue(encoder.encode('data: {invalid}\n\n'));
        else if (failure === 'disconnect') { c.error(new Error('simulated disconnect')); return; }
        c.close();
      });
    }}), {headers: {'content-type': 'text/event-stream'}});
  });
  const matcher = new WorkflowMatcher(new AIGateway(f.settings, client));
  const service = new WorkflowService({...f.deps, evaluateBatch: (condition, posts, guard, report) => matcher.evaluate(condition, posts, guard, report)});
  const w = f.repo.save({...f.input, source: 'home', usernames: []});
  const running = service.run(w.id);
  try {
    await received.promise;
    assert.equal(service.runs()[0]?.checked, 0); assert.deepEqual(f.repo.records(w.id), []);
    assert.equal(f.repo.seen(w.id, '100'), false); assert.ok(!f.calls.includes('follow'));
    release.resolve(); await running;
    assert.equal(service.runs()[0]?.status, 'failed'); assert.equal(service.runs()[0]?.checked, 0);
    assert.deepEqual(f.repo.records(w.id), []); assert.equal(f.repo.seen(w.id, '100'), false);
    assert.equal(requests, 1); assert.ok(!f.calls.includes('follow')); assert.ok(!f.calls.includes('reply'));
    broken = false; await service.run(w.id);
    assert.equal(service.runs()[0]?.status, 'done'); assert.equal(service.runs()[0]?.completed, 1);
    assert.equal(requests, 2); assert.equal(f.calls.filter(c => c === 'follow').length, 1); assert.equal(f.calls.filter(c => c === 'reply').length, 1);
  } finally { release.resolve(); await running; await service.stop(); f.db.close(); }
});

function retryInput(service: WorkflowService, id: string, confirmUncertain = false) {
  const plan = service.retryPlan(id);
  return { runId: plan.run?.id, revision: plan.revision, configuration: plan.configuration, recordIds: plan.records.map(r => r.id), restoreEnabled: plan.restoreEnabled, confirmUncertain };
}

test('whole-round recovery persists every hit before actions and keeps original counters across two retries and restarts', async () => {
  const f = fixture();
  const base = (await f.deps.x.home())[0]!;
  const items = Array.from({ length: 20 }, (_, i) => ({ ...base, userId: `target-${i}`,
    post: { ...base.post, id: String(100 + i), author: `author${i}` } }));
  const w = f.repo.save({ ...f.input, source: 'home', usernames: [], actions: [{ type: 'follow' }, { type: 'reply', mode: 'skill' }] });
  let fetches = 0, analyses = 0, draftFailure = true, followFailure = true;
  const effects: string[] = [];
  const deps = { ...f.deps, x: { ...f.deps.x,
    home: async () => { fetches++; return items; },
    follow: async (_identity: unknown, id: string) => {
      // Even at the first side effect, the remaining hits and ALL decisions must be durable.
      assert.equal(f.repo.records(w.id).length, 3);
      assert.ok(items.every(item => f.repo.seen(w.id, item.post.id)));
      effects.push(`follow:${id}`);
      if (id === 'target-2' && followFailure) throw new Error('network lost');
      return { following: true, followedBy: false };
    },
    reply: async (_identity: unknown, id: string) => { effects.push(`reply:${id}`); return `reply-${id}`; },
  }, evaluateBatch: async (_condition: string, posts: SocialPost[]) => {
    analyses++; return posts.map((post, i) => ({ postId: post.id, matched: i < 3, message: 'match' }));
  }, generateReply: async (_account: string, post: SocialPost) => {
    if (post.id === '101' && draftFailure) throw new Error('AI temporarily unavailable');
    return 'draft';
  } };
  let service = new WorkflowService(deps);
  try {
    await service.run(w.id);
    const original = service.runs()[0]!;
    assert.deepEqual([original.scanned, original.aiMatched, original.completed], [20, 3, 1]);
    assert.deepEqual(f.repo.records(w.id).map(r => r.status), ['pending', 'failed', 'done']);
    assert.ok(f.repo.records(w.id).every(r => r.runId === original.id));
    await service.stop(); service = new WorkflowService(deps);
    assert.deepEqual(service.runs()[0], original);
    const plan = service.retryPlan(w.id);
    assert.deepEqual(plan.records.map(r => r.post.id), ['101', '102']);
    const stale = retryInput(service, w.id);
    draftFailure = false;
    service.retryOnce(w.id, stale); await service.run(w.id);
    assert.deepEqual([service.runs()[0]?.id, service.runs()[0]?.startedAt], [original.id, original.startedAt]);
    assert.deepEqual([service.runs()[0]?.scanned, service.runs()[0]?.aiMatched, service.runs()[0]?.completed], [20, 3, 2]);
    assert.throws(() => service.retryOnce(w.id, stale), /已变化/);
    await service.stop(); service = new WorkflowService(deps); followFailure = false;
    service.retryOnce(w.id, retryInput(service, w.id)); await service.run(w.id);
    assert.deepEqual([fetches, analyses], [1, 1]);
    assert.deepEqual([service.runs()[0]?.id, service.runs()[0]?.status, service.runs()[0]?.scanned, service.runs()[0]?.aiMatched, service.runs()[0]?.completed], [original.id, 'done', 20, 3, 3]);
    assert.deepEqual(effects, ['follow:target-0', 'reply:100', 'follow:target-1', 'reply:101', 'follow:target-2', 'follow:target-2', 'reply:102']);
    assert.equal(f.repo.get(w.id)?.lastError, null); assert.equal(f.repo.get(w.id)?.enabled, true);
    await service.stop(); service = new WorkflowService(deps);
    assert.equal(service.runs()[0]?.completed, 3);
    // A later successful round gets a new ID; cumulative statistics do not leak into it.
    await service.run(w.id);
    assert.notEqual(service.runs()[0]?.id, original.id);
    assert.deepEqual([service.runs()[0]?.scanned, service.runs()[0]?.aiMatched, service.runs()[0]?.completed], [20, 0, 0]);
  } finally { await service.stop(); f.db.close(); }
});

test('checkpoint publication rolls back all hits and seen IDs if any record cannot be saved', async () => {
  const f = fixture(), base = (await f.deps.x.home())[0]!;
  const w = f.repo.save({ ...f.input, source: 'home', usernames: [] });
  f.db.exec(`CREATE TRIGGER fail_second_record BEFORE INSERT ON workflow_records
    WHEN json_extract(NEW.value,'$.post.id')='101' BEGIN SELECT RAISE(ABORT, 'mock disk failure'); END`);
  const service = new WorkflowService({ ...f.deps, x: { ...f.deps.x, home: async () => [base, { ...base, post: { ...base.post, id: '101' } }] } });
  try {
    await service.run(w.id);
    assert.match(service.runs()[0]!.error!, /mock disk failure/);
    assert.deepEqual(f.repo.records(w.id), []);
    assert.equal(f.repo.seen(w.id, '100'), false); assert.equal(f.repo.seen(w.id, '101'), false);
    assert.equal(f.repo.checkpoint(w.id)?.analysisComplete, false);
    assert.ok(!f.calls.includes('follow'));
    f.db.exec('DROP TRIGGER fail_second_record');
    service.retryOnce(w.id, retryInput(service, w.id)); await service.run(w.id);
    assert.equal(service.runs()[0]?.status, 'done');
  } finally { await service.stop(); f.db.close(); }
});

test('restart recovers the complete queue beyond the 100-row history view and can finalize an already completed queue', async () => {
  const f = fixture(), base = (await f.deps.x.home())[0]!;
  const w = f.repo.save({ ...f.input, source: 'home', usernames: [], actions: [{ type: 'notify', content: '' }] });
  let fail = true, fetches = 0, effects = 0;
  const deps = { ...f.deps, x: { ...f.deps.x, home: async () => {
    fetches++; return Array.from({ length: 120 }, (_, i) => ({ ...base, post: { ...base.post, id: String(100 + i) } }));
  } }, notify: async () => { if (fail) throw new Error('mock failure'); effects++; } };
  let service = new WorkflowService(deps);
  try {
    await service.run(w.id);
    const round = f.repo.checkpoint(w.id)!;
    assert.equal(round.recordIds.length, 120);
    // Simulate a process exiting before the final failure status could be committed.
    round.run.status = 'running'; f.repo.saveCheckpoint(round);
    await service.stop(); service = new WorkflowService(deps);
    assert.equal(service.retryPlan(w.id).records.length, 120);
    fail = false;
    service.retryOnce(w.id, retryInput(service, w.id, true)); await service.run(w.id);
    assert.equal(effects, 120); assert.equal(fetches, 1); assert.equal(service.runs()[0]?.completed, 120);
    const completed = f.repo.checkpoint(w.id)!;
    completed.run.status = 'running'; f.repo.saveCheckpoint(completed);
    await service.stop(); service = new WorkflowService(deps);
    assert.deepEqual(service.retryPlan(w.id).records, []);
    service.retryOnce(w.id, retryInput(service, w.id)); await service.run(w.id);
    assert.equal(effects, 120); assert.equal(fetches, 1); assert.equal(service.runs()[0]?.completed, 120);
    assert.equal(service.runs()[0]?.id, round.run.id); assert.equal(service.runs()[0]?.status, 'done');
  } finally { await service.stop(); f.db.close(); }
});

for (const applied of [false, true]) test(`manual retry reconciles an uncertain tracked follow (applied=${applied}) without replaying AI or completed posts`, async () => {
  const f = fixture(), followingRepo = new FollowingRepository(f.db);
  let following = false, writes = 0, fetches = 0, analyses = 0;
  const tracked = new FollowingService(followingRepo, f.settings, {
    identity: f.deps.x.identity,
    profile: async () => ({ account: { id: '2', username: 'author', name: 'Author', bio: '', fetchedAt: '' }, following, followedBy: false }),
    follow: async () => { writes++; following = writes > 1 || applied; if (writes === 1) throw new Error('fetch failed'); return { following: true, followedBy: false }; },
    unfollow: async () => { throw new Error('unexpected unfollow'); },
  }, async () => ({ summary: 'fixture', summaryEvidence: [] }));
  const deps = { ...f.deps, deferPortraits: tracked.deferPortraits.bind(tracked),
    x: { ...f.deps.x, home: async () => { fetches++; return f.deps.x.home(); },
      follow: tracked.follow.bind(tracked), retryFollow: tracked.retryFollow.bind(tracked), followSkipReason: tracked.followSkipReason.bind(tracked) },
    evaluateBatch: async (condition: string, posts: SocialPost[]) => { analyses++; return f.deps.evaluateBatch(condition, posts); } };
  let service = new WorkflowService(deps);
  const w = f.repo.save({ ...f.input, source: 'home', usernames: [], actions: [{ type: 'follow' }] });
  try {
    await service.run(w.id);
    assert.equal(f.repo.get(w.id)?.enabled, false);
    const id = f.repo.records(w.id)[0]!.id;
    await service.stop(); service = new WorkflowService(deps); // Recovery information survives restart.
    const input = retryInput(service, w.id);
    assert.deepEqual([writes, fetches, analyses], [1, 1, 1]); // Previewing a retry does no external work.
    service.retryOnce(w.id, input); await service.run(w.id);
    assert.deepEqual([writes, fetches, analyses], [applied ? 1 : 2, 1, 1]);
    assert.equal(service.runs()[0]?.status, 'done'); assert.equal(service.runs()[0]?.completed, 1);
    const record = f.repo.records(w.id)[0]!;
    assert.equal(record.id, id); assert.equal(record.status, 'done'); assert.equal(record.resume, undefined);
    assert.equal(record.actions[0]?.newlyFollowed, !applied);
    assert.equal(followingRepo.list('1')[0]?.status, 'following');
    assert.equal(f.repo.get(w.id)?.enabled, true); assert.equal(f.repo.get(w.id)?.lastError, null);
    assert.equal(f.repo.get(w.id)?.resumeEnabledAfterFailure, false);
    assert.throws(() => service.retryOnce(w.id, input), /没有需要重试/); // Stale double click after completion cannot start a new run.
  } finally { await service.stop(); await tracked.stop(); f.db.close(); }
});

for (const mode of ['already_following', 'opt_out', 'profile_failure', 'other_actor'] as const)
  test(`manual retry honors tracked relationship boundary: ${mode}`, async () => {
    const f = fixture(), followingRepo = new FollowingRepository(f.db);
    let reads = 0, writes = 0, retrying = false;
    const tracked = new FollowingService(followingRepo, f.settings, {
      identity: f.deps.x.identity,
      profile: async () => {
        reads++; if (retrying && mode === 'profile_failure') throw new Error('profile unavailable');
        return { account: { id: '2', username: 'author', name: 'Author', bio: '', fetchedAt: '' }, following: retrying && mode === 'already_following', followedBy: false };
      },
      follow: async () => { writes++; throw new Error('fetch failed'); },
      unfollow: async () => { throw new Error('unexpected unfollow'); },
    }, async () => ({ summary: 'fixture', summaryEvidence: [] }));
    const service = new WorkflowService({ ...f.deps, deferPortraits: tracked.deferPortraits.bind(tracked), x: { ...f.deps.x,
      follow: tracked.follow.bind(tracked), retryFollow: tracked.retryFollow.bind(tracked), followSkipReason: tracked.followSkipReason.bind(tracked) } });
    const w = f.repo.save(f.input);
    try {
      await service.run(w.id); retrying = true;
      if (mode === 'opt_out') followingRepo.save({ ...followingRepo.list('1')[0]!, status: 'not_following' });
      if (mode === 'other_actor') {
        const record = f.repo.records(w.id)[0]!;
        f.repo.record({ ...record, resume: { ...record.resume!, actorId: '99' } });
      }
      service.retryOnce(w.id, retryInput(service, w.id)); await service.run(w.id);
      assert.equal(writes, 1); assert.ok(!f.calls.includes('reply')); assert.ok(!f.calls.includes('notify'));
      const failed = mode === 'profile_failure' || mode === 'other_actor';
      assert.equal(service.runs()[0]?.status, failed ? 'failed' : 'done');
      assert.equal(f.repo.records(w.id)[0]?.status, failed ? (mode === 'other_actor' ? 'failed' : 'uncertain') : 'skipped');
      assert.equal(f.repo.get(w.id)?.enabled, !failed);
      if (mode === 'opt_out' || mode === 'other_actor') assert.equal(reads, 1);
    } finally { await service.stop(); await tracked.stop(); f.db.close(); }
  });

test('manual reply retry needs explicit confirmation, retains draft, skips successful actions and shares the run lock', async () => {
  const f = fixture(), gate = Promise.withResolvers<void>();
  let attempts = 0, generations = 0;
  const sent: string[] = [];
  const service = new WorkflowService({ ...f.deps, generateReply: async () => { generations++; return 'the original draft'; },
    x: { ...f.deps.x, reply: async (_identity, _postId, text) => { attempts++; sent.push(text);
      if (attempts === 1) throw new Error('connection reset'); await gate.promise; return '200'; } } });
  const w = f.repo.save({ ...f.input, actions: [{ type: 'follow' }, { type: 'notify', content: '' }, { type: 'reply', mode: 'skill' }] });
  try {
    await service.run(w.id);
    assert.throws(() => service.retryOnce(w.id, retryInput(service, w.id)), /确认未发送/);
    assert.equal(attempts, 1);
    const input = retryInput(service, w.id, true), first = service.retryOnce(w.id, input)!;
    assert.equal(service.retryOnce(w.id, input)?.id, first.id);
    assert.equal(service.runOnce(w.id)?.id, first.id);
    gate.resolve(); await service.run(w.id);
    assert.equal(service.runs()[0]?.status, 'done');
    assert.deepEqual(sent, ['the original draft', 'the original draft']); assert.equal(generations, 1);
    assert.equal(f.calls.filter(c => c === 'follow').length, 1); assert.equal(f.calls.filter(c => c === 'notify').length, 1);
    assert.deepEqual(f.repo.records(w.id)[0]?.actions.map(a => a.status), ['done', 'done', 'done']);
    assert.equal(f.repo.get(w.id)?.lastError, null); assert.equal(f.repo.get(w.id)?.enabled, true);
  } finally { gate.resolve(); await service.stop(); f.db.close(); }
});

for (const enabled of [true, false]) test(`safe AI retry preserves the original schedule choice (${enabled}) across repeated failures`, async () => {
  const f = fixture(); let attempts = 0;
  const service = new WorkflowService({ ...f.deps, generateReply: async () => {
    if (++attempts < 3) throw new Error('AI timeout'); return 'new reply';
  } });
  const w = f.repo.save({ ...f.input, enabled, actions: [{ type: 'follow' }, { type: 'reply', mode: 'skill' }] });
  try {
    await service.run(w.id, true);
    for (let i = 0; i < 2; i++) {
      assert.equal(retryInput(service, w.id).restoreEnabled, enabled);
      service.retryOnce(w.id, retryInput(service, w.id)); await service.run(w.id);
    }
    assert.equal(service.runs()[0]?.status, 'done'); assert.equal(f.repo.get(w.id)?.enabled, enabled);
    assert.equal(f.calls.filter(c => c === 'follow').length, 1); assert.equal(f.calls.filter(c => c === 'reply').length, 1);
    assert.equal(f.repo.records(w.id)[0]?.status, 'done');
  } finally { await service.stop(); f.db.close(); }
});

test('retry endpoints validate the confirmed snapshot and recover a failure before any action record exists', async () => {
  const f = fixture(), app = Fastify(); let attempts = 0;
  f.deps.evaluateBatch = async (_condition, posts) => {
    if (++attempts === 1) throw new Error('AI 504'); return posts.map(p => ({ postId: p.id, matched: false, message: '' }));
  };
  const w = f.repo.save(f.input), service = new WorkflowService(f.deps);
  registerWorkflowRoutes(app, f.repo, service, f.settings);
  app.setErrorHandler((error, _req, reply) => { reply.code(400).send({ error: String(error) }); });
  try {
    await service.run(w.id);
    const plan = (await app.inject(`/api/workflows/${w.id}/retry`)).json().data;
    assert.equal(plan.records.length, 0); assert.equal(attempts, 1);
    const input = retryInput(service, w.id);
    assert.equal((await app.inject({ method: 'POST', url: `/api/workflows/${w.id}/retry`, payload: { ...input, recordIds: ['stale'] } })).statusCode, 400);
    assert.equal(attempts, 1);
    assert.equal((await app.inject({ method: 'POST', url: `/api/workflows/${w.id}/retry`, payload: input })).statusCode, 202);
    await service.run(w.id);
    assert.equal(attempts, 2); assert.equal(f.repo.get(w.id)?.lastError, null);
    assert.equal(service.runs()[0]?.status, 'done');
    assert.equal((await app.inject({ method: 'POST', url: '/api/workflows/missing/retry', payload: input })).statusCode, 404);
  } finally { await service.stop(); await app.close(); f.db.close(); }
});

test('retry rejects changed configuration and retains the original randomly selected execution account', async () => {
  const f = fixture();
  const second = f.settings.configuration.saveAccount({ name: 'Other', username: 'other', cookie: 'auth_token=test; ct0=test; twid=u%3D9', configIds: [] });
  let random = 0, attempts = 0;
  const ids: string[] = [];
  const service = new WorkflowService({ ...f.deps, random: () => random,
    x: { ...f.deps.x, follow: async identity => { ids.push(identity.cookieId); if (++attempts === 1) throw new Error('fetch failed'); return { following: true, followedBy: false }; } } });
  const w = f.repo.save({ ...f.input, accountId: RANDOM_WORKFLOW_ACCOUNT, actions: [{ type: 'follow' }] });
  try {
    await service.run(w.id); random = 0.99;
    const input = retryInput(service, w.id);
    assert.notEqual(f.repo.records(w.id)[0]?.accountId, second.id);
    assert.throws(() => service.retryOnce(w.id, { ...input, configuration: 'changed' }), /已变化/);
    service.retryOnce(w.id, input); await service.run(w.id);
    assert.deepEqual(ids, [f.input.accountId, f.input.accountId]);
    assert.equal(service.runs()[0]?.status, 'done');
  } finally { await service.stop(); f.db.close(); }
});

test('obsolete failures from a previous configuration do not block retrying the current failure', async () => {
  const f = fixture(); let attempts = 0;
  const service = new WorkflowService({ ...f.deps, x: { ...f.deps.x,
    follow: async () => { if (++attempts === 1) throw new Error('current failure'); return { following: true, followedBy: false }; } } });
  const w = f.repo.save({ ...f.input, actions: [{ type: 'follow' }] });
  try {
    await service.run(w.id);
    const current = f.repo.records(w.id)[0]!;
    f.repo.record({ ...current, id: 'old-record', resume: { ...current.resume!, configuration: 'old-configuration' },
      actions: [{ type: 'follow', status: 'uncertain', result: 'previous failure' }] });
    const input = retryInput(service, w.id);
    assert.deepEqual(input.recordIds, [current.id]);
    service.retryOnce(w.id, input); await service.run(w.id);
    assert.equal(service.runs()[0]?.status, 'done'); assert.equal(attempts, 2);
    assert.equal(f.repo.records(w.id).find(r => r.id === 'old-record')?.status, 'uncertain');
  } finally { await service.stop(); f.db.close(); }
});

test('retry keeps the configured order when a failed notification precedes an unsent follow', async () => {
  const f = fixture(), order: string[] = []; let failed = true;
  const service = new WorkflowService({ ...f.deps,
    notify: async () => { order.push('notify'); if (failed) throw new Error('notification failed'); },
    x: { ...f.deps.x, follow: async () => { order.push('follow'); return { following: true, followedBy: false }; } } });
  const w = f.repo.save({ ...f.input, actions: [{ type: 'notify', content: '' }, { type: 'follow' }] });
  try {
    await service.run(w.id); failed = false;
    service.retryOnce(w.id, retryInput(service, w.id, true)); await service.run(w.id);
    assert.deepEqual(order, ['notify', 'notify', 'follow']);
    assert.equal(service.runs()[0]?.status, 'done');
  } finally { await service.stop(); f.db.close(); }
});
