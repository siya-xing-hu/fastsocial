import { XRequestQueue } from '../adapters/x/request-queue.ts';
import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../app.ts";
import { parseXHomeTimeline } from "../adapters/x/x-parser.ts";

const tweet = (id: string, author: string) => ({
  __typename: "Tweet", rest_id: id,
  core: { user_results: { result: { rest_id: author, core: { screen_name: `user${author}` }, legacy: { protected: true } } } },
  legacy: { full_text: `Post ${id}`, created_at: "Fri Oct 09 10:00:00 +0000 2026" },
});
const entry = (id: string, author: string) => ({
  entryId: `tweet-${id}`, content: { itemContent: { tweet_results: { result: tweet(id, author) } } },
});
const home = (entries: unknown[]) => ({ data: { home: { home_timeline_urt: { instructions: [{ type: "TimelineAddEntries", entries }] } } } });

async function account(app: ReturnType<typeof createApp>, username: string) {
  const response = await app.inject({ method: "POST", url: "/api/accounts", payload: {
    name: username, username, cookie: `auth_token=${username}; ct0=csrf-${username}`, configIds: [],
  } });
  assert.equal(response.statusCode, 200);
  return response.json().data.id as string;
}

test("account test reads its own home timeline without a username or twid, and updates only its Cookie status", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const app = createApp({ xRequestQueue: new XRequestQueue({ intervalMs: 0 }), fetchImpl: async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json(home([entry("100", "8"), entry("101", "9")]));
  } });
  try {
    const first = await account(app, "first"), second = await account(app, "second");
    const response = await app.inject({ method: "POST", url: `/api/accounts/${second}/test`, payload: { cookieId: first } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().data.accountId, second);
    assert.deepEqual(response.json().data.posts.map((p: any) => p.author), ["user8", "user9"]);
    assert.equal(calls.length, 1);
    assert.match(calls[0]!.url, /\/HomeTimeline$/);
    assert.equal(calls[0]!.init?.method, "POST");
    const headers = new Headers(calls[0]!.init?.headers);
    assert.equal(headers.get("cookie"), "auth_token=second; ct0=csrf-second");
    assert.equal(headers.get("referer"), "https://x.com/home");
    const body = JSON.parse(String(calls[0]!.init?.body));
    assert.equal(body.variables.count, 20);
    assert.deepEqual(body.variables.seenTweetIds, []);
    const accounts = (await app.inject({ url: "/api/accounts" })).json().data;
    assert.equal(accounts.find((a: any) => a.id === first).status, "unchecked");
    assert.equal(accounts.find((a: any) => a.id === second).status, "valid");
    assert.equal(response.body.includes("auth_token"), false);
  } finally { await app.close(); }
});

test("account test never switches accounts on failure, and can recheck a previously invalid Cookie", async () => {
  let status = 401, calls = 0;
  const app = createApp({ xRequestQueue: new XRequestQueue({ intervalMs: 0 }), fetchImpl: async (_url, init) => {
    calls++;
    assert.equal(new Headers(init?.headers).get("cookie"), "auth_token=first; ct0=csrf-first");
    return status === 200 ? Response.json(home([])) : new Response("unauthorized", { status });
  } });
  try {
    const first = await account(app, "first"), second = await account(app, "second");
    const response = await app.inject({ method: "POST", url: `/api/accounts/${first}/test` });
    assert.equal(response.statusCode, 500);
    assert.match(response.json().error.message, /认证失败/);
    assert.equal(calls, 1);
    const accounts = (await app.inject({ url: "/api/accounts" })).json().data;
    assert.equal(accounts.find((a: any) => a.id === first).status, "invalid");
    assert.equal(accounts.find((a: any) => a.id === second).status, "unchecked");
    status = 200;
    const recovered = await app.inject({ method: "POST", url: `/api/accounts/${first}/test` });
    assert.equal(recovered.statusCode, 200);
    assert.deepEqual(recovered.json().data.posts, []);
    assert.equal(calls, 2);
    assert.equal((await app.inject({ url: "/api/accounts" })).json().data.find((a: any) => a.id === first).status, "valid");
  } finally { await app.close(); }
});

test("account test rejects missing accounts and malformed home responses instead of reporting a successful empty feed", async () => {
  let calls = 0;
  const app = createApp({ xRequestQueue: new XRequestQueue({ intervalMs: 0 }), fetchImpl: async () => { calls++; return Response.json({ data: {} }); } });
  try {
    const missing = await app.inject({ method: "POST", url: "/api/accounts/missing/test" });
    assert.equal(missing.statusCode, 404);
    assert.equal(calls, 0);
    const id = await account(app, "first");
    const response = await app.inject({ method: "POST", url: `/api/accounts/${id}/test` });
    assert.equal(response.statusCode, 500);
    assert.match(response.json().error.message, /首页响应结构/);
    assert.equal((await app.inject({ url: "/api/accounts" })).json().data[0].status, "unchecked");
  } finally { await app.close(); }
});

test("home preview preserves timeline order and readable protected/reposted posts while excluding ads and duplicates", () => {
  const original = entry("100", "8");
  const repost = entry("101", "9");
  Object.assign(repost.content.itemContent.tweet_results.result.legacy, { retweeted_status_result: { result: tweet("90", "5") } });
  const promoted = { ...entry("102", "10"), entryId: "promoted-102" };
  const module = { content: { items: [{ item: { itemContent: entry("103", "11").content.itemContent } }] } };
  const posts = parseXHomeTimeline(home([original, promoted, original, repost, module]));
  assert.deepEqual(posts.map(p => p.id), ["100", "101", "103"]);
  assert.equal(posts[1]?.type, "repost");
  assert.equal(posts[1]?.text, "Post 90");
  assert.deepEqual(parseXHomeTimeline(home([])), []);
  assert.throws(() => parseXHomeTimeline({}), /首页响应结构/);
});
