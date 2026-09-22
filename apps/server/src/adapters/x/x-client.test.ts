import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { openDatabase } from "../../db/database.ts";
import { SettingsRepository } from "../../repositories/settings-repository.ts";
import { XClient } from "./x-client.ts";

test("X client sends cookie auth and parses a user timeline", async () => {
  const database = openDatabase(":memory:");
  const settings = new SettingsRepository(database);
  settings.update({ x: { cookie: "auth_token=session; ct0=csrf" } });
  const fixture = readFileSync(new URL("./__fixtures__/user-timeline.json", import.meta.url), "utf8");
  const requests: Array<{ url: string; headers: Headers }> = [];
  const responses = [
    new Response(JSON.stringify({ data: { user: { result: { rest_id: "42" } } } })),
    new Response(fixture),
  ];
  const client = new XClient(settings, async (input, init) => {
    requests.push({ url: String(input), headers: new Headers(init?.headers) });
    return responses.shift()!;
  });
  const posts = await client.fetchRecentPosts("@example");
  assert.equal(posts[0]?.id, "200");
  assert.match(requests[0]?.url ?? "", /Gb-d6r0vxPOADdG62OEBpQ\/UserByScreenName/);
  assert.match(requests[1]?.url ?? "", /SXVCYB8XHSS25nzIljNtZA\/UserTweets/);
  assert.equal(requests[0]?.headers.get("x-csrf-token"), "csrf");
  assert.equal(requests[0]?.headers.get("cookie"), "auth_token=session; ct0=csrf");
  assert.match(requests[0]?.headers.get("authorization") ?? "", /^Bearer A+/);
  database.close();
});

test("X client rejects missing or invalid cookie configuration", async () => {
  const database = openDatabase(":memory:");
  const settings = new SettingsRepository(database);
  const client = new XClient(settings, async () => new Response("{}"));
  await assert.rejects(() => client.fetchRecentPosts("example"), /配置 X Cookie/);
  settings.update({ x: { cookie: "auth_token=session" } });
  await assert.rejects(() => client.fetchRecentPosts("example"), /缺少 ct0/);
  database.close();
});
