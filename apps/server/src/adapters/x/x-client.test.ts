import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { openDatabase } from "../../db/database.ts";
import { SettingsRepository } from "../../repositories/settings-repository.ts";
import { XClient } from "./x-client.ts";

const fixture = readFileSync(
  new URL("./__fixtures__/user-timeline.json", import.meta.url),
  "utf8",
);

function userResponse(): Response {
  return new Response(JSON.stringify({ data: { user: { result: { rest_id: "42" } } } }));
}

function timelineResponse(): Response {
  return new Response(fixture);
}

test("X client keeps one randomly selected Cookie for the complete timeline request", async () => {
  const database = openDatabase(":memory:");
  const settings = new SettingsRepository(database);
  settings.update({
    x: {
      cookies: [
        {
          id: "first",
          name: "First",
          enabled: true,
          cookie: "auth_token=first; ct0=csrf-first",
        },
        {
          id: "second",
          name: "Second",
          enabled: true,
          cookie: "auth_token=second; ct0=csrf-second",
        },
      ],
    },
  });
  const requests: Array<{ url: string; headers: Headers }> = [];
  const responses = [userResponse(), timelineResponse()];
  const client = new XClient(settings, async (input, init) => {
    requests.push({ url: String(input), headers: new Headers(init?.headers) });
    return responses.shift()!;
  }, () => 0);

  const posts = await client.fetchRecentPosts("@example");

  assert.equal(posts[0]?.id, "200");
  assert.match(requests[0]?.url ?? "", /KybxDj9RrADIITXlGG8kpw\/UserByScreenName/);
  assert.match(requests[1]?.url ?? "", /jeAA-59Y9FL7FmjgBNIVPw\/UserTweets/);
  const userQuery = new URL(requests[0]!.url).searchParams;
  assert.equal(JSON.parse(userQuery.get("variables")!).withGrokTranslatedBio, true);
  assert.deepEqual(JSON.parse(userQuery.get("fieldToggles")!), {
    withAuxiliaryUserLabels: true, withPayments: false,
  });
  const timelineQuery = new URL(requests[1]!.url).searchParams;
  const features = JSON.parse(timelineQuery.get("features")!);
  assert.equal(features.rweb_cashtags_enabled, true);
  assert.equal(features.content_disclosure_indicator_enabled, true);
  assert.equal(features.premium_content_api_read_enabled, false);
  assert.equal(features.responsive_web_grok_community_note_auto_translation_is_enabled, true);
  assert.deepEqual(JSON.parse(timelineQuery.get("fieldToggles")!), {
    withArticlePlainText: false, withPayments: false,
  });
  assert.equal(requests[0]?.headers.get("x-csrf-token"), "csrf-second");
  assert.equal(requests[0]?.headers.get("cookie"), "auth_token=second; ct0=csrf-second");
  assert.equal(requests[1]?.headers.get("cookie"), "auth_token=second; ct0=csrf-second");
  assert.match(requests[0]?.headers.get("authorization") ?? "", /^Bearer A+/);
  for (const request of requests) {
    assert.match(request.headers.get("user-agent") ?? "", /Mozilla\/5\.0.*Chrome\//);
    assert.equal(request.headers.get("referer"), "https://x.com/example");
    assert.equal(request.headers.get("origin"), "https://x.com");
    assert.equal(request.headers.get("accept-language"), "en-US,en;q=0.9");
    assert.equal(request.headers.get("sec-fetch-dest"), "empty");
    assert.equal(request.headers.get("sec-fetch-mode"), "cors");
    assert.equal(request.headers.get("sec-fetch-site"), "same-origin");
  }
  assert.equal(settings.getX().cookies.find((entry) => entry.id === "second")?.status, "valid");
  database.close();
});

test("X client marks an authentication failure invalid and retries another Cookie", async () => {
  const database = openDatabase(":memory:");
  const settings = new SettingsRepository(database);
  settings.update({
    x: {
      cookies: [
        {
          id: "expired",
          name: "Expired",
          enabled: true,
          cookie: "auth_token=expired; ct0=csrf-expired",
        },
        {
          id: "working",
          name: "Working",
          enabled: true,
          cookie: "auth_token=working; ct0=csrf-working",
        },
      ],
    },
  });
  const requestCookies: string[] = [];
  const responses = [
    new Response(JSON.stringify({ errors: [{ code: 89, message: "Invalid or expired token" }] })),
    userResponse(),
    timelineResponse(),
  ];
  const client = new XClient(settings, async (_input, init) => {
    requestCookies.push(new Headers(init?.headers).get("cookie") ?? "");
    return responses.shift()!;
  }, () => 0.99);

  const posts = await client.fetchRecentPosts("example");

  assert.equal(posts[0]?.id, "200");
  assert.deepEqual(requestCookies, [
    "auth_token=expired; ct0=csrf-expired",
    "auth_token=working; ct0=csrf-working",
    "auth_token=working; ct0=csrf-working",
  ]);
  const expired = settings.getPublic().x.cookies.find((entry) => entry.id === "expired");
  assert.equal(expired?.status, "invalid");
  assert.equal(expired?.lastError, "Invalid or expired token");
  assert.ok(expired?.lastCheckedAt);
  assert.equal(
    settings.getPublic().x.cookies.find((entry) => entry.id === "working")?.status,
    "valid",
  );
  database.close();
});

test("X client retries an ordinary 403 once with another Cookie without invalidating it", async () => {
  const database = openDatabase(":memory:");
  const settings = new SettingsRepository(database);
  settings.update({
    x: {
      cookies: [
        {
          id: "first",
          name: "First",
          enabled: true,
          cookie: "auth_token=first; ct0=csrf-first",
        },
        {
          id: "second",
          name: "Second",
          enabled: true,
          cookie: "auth_token=second; ct0=csrf-second",
        },
      ],
    },
  });
  let requestCount = 0;
  const client = new XClient(settings, async () => {
    requestCount += 1;
    return new Response(JSON.stringify({ errors: [{ code: 200, message: "Forbidden" }] }), {
      status: 403,
    });
  }, () => 0);

  await assert.rejects(() => client.fetchRecentPosts("example"), /请求失败（403）/);
  assert.equal(requestCount, 2);
  assert.deepEqual(settings.getX().cookies.map((entry) => entry.status), ["unchecked", "unchecked"]);
  database.close();
});

test("X client allows explicitly testing an invalid Cookie", async () => {
  const database = openDatabase(":memory:");
  const settings = new SettingsRepository(database);
  const cookie = "auth_token=session; ct0=csrf";
  settings.update({
    x: { cookies: [{ id: "target", name: "Target", enabled: false, cookie }] },
  });
  settings.updateXCookieStatus("target", cookie, "invalid", "previous failure");
  const responses = [userResponse(), timelineResponse()];
  const client = new XClient(settings, async () => responses.shift()!);

  await client.fetchRecentPosts("example", "target");

  const target = settings.getPublic().x.cookies[0];
  assert.equal(target?.status, "valid");
  assert.equal(target?.lastError, undefined);
  database.close();
});

test("X client identifies a missing web operation and retries once without invalidating Cookies", async (t) => {
  for (const operation of ["UserByScreenName", "UserTweets"]) {
    await t.test(operation, async () => {
      const database = openDatabase(":memory:");
      try {
        const settings = new SettingsRepository(database);
        settings.update({ x: { cookies: [
          { id: "first", name: "First", enabled: true, cookie: "auth_token=one; ct0=csrf" },
          { id: "second", name: "Second", enabled: true, cookie: "auth_token=two; ct0=csrf" },
        ] } });
        let requestCount = 0;
        const client = new XClient(settings, async () => {
          requestCount += 1;
          if (operation === "UserTweets" && requestCount % 2 === 1) return userResponse();
          return new Response("", { status: 404 });
        }, () => 0);

        await assert.rejects(() => client.fetchRecentPosts("example"), (error: Error) => {
          assert.match(error.message, new RegExp(`${operation}.*404`));
          assert.match(error.message, /请求标识和浏览器请求头/);
          assert.doesNotMatch(error.message, /auth_token|ct0/);
          return true;
        });
        assert.equal(requestCount, operation === "UserTweets" ? 4 : 2);
        assert.deepEqual(settings.getX().cookies.map((cookie) => cookie.status), ["unchecked", "unchecked"]);
      } finally {
        database.close();
      }
    });
  }
});

test("X client rejects missing configuration and marks a malformed Cookie invalid", async () => {
  const database = openDatabase(":memory:");
  const settings = new SettingsRepository(database);
  const client = new XClient(settings, async () => new Response("{}"));
  await assert.rejects(() => client.fetchRecentPosts("example"), /配置 X Cookie/);

  settings.update({
    x: {
      cookies: [{
        id: "malformed",
        name: "Malformed",
        enabled: true,
        cookie: "auth_token=session",
      }],
    },
  });
  await assert.rejects(
    () => client.fetchRecentPosts("example", "malformed"),
    /缺少 ct0/,
  );
  assert.equal(settings.getPublic().x.cookies[0]?.status, "invalid");
  database.close();
});

test("X client reports clearly when every enabled Cookie is invalid", async () => {
  const database = openDatabase(":memory:");
  const settings = new SettingsRepository(database);
  const cookie = "auth_token=expired; ct0=csrf";
  settings.update({
    x: { cookies: [{ id: "expired", name: "Expired", enabled: true, cookie }] },
  });
  settings.updateXCookieStatus("expired", cookie, "invalid", "expired");
  const client = new XClient(settings, async () => new Response("{}"));

  await assert.rejects(
    () => client.fetchRecentPosts("example"),
    /所有已启用的 X Cookie 均已失效/,
  );
  database.close();
});

test('random Cookie selection has no usage balancing and retries at most once with a different Cookie', async () => {
  const database = openDatabase(':memory:');
  const settings = new SettingsRepository(database);
  settings.update({ x: { cookies: ['one', 'two', 'three'].map(id => ({ id, name: id, enabled: true, cookie: `auth_token=${id}; ct0=csrf` })) } });
  const used: string[] = [];
  let fail = false;
  const client = new XClient(settings, async (_url, init) => {
    used.push(new Headers(init?.headers).get('cookie')!);
    if (fail) throw new Error('network offline');
    return userResponse();
  }, () => 0.99);
  await client.fetchAccount('example');
  await client.fetchAccount('example');
  assert.equal(used[0], used[1]); // RNG may choose the same Cookie on consecutive requests.
  fail = true;
  await assert.rejects(client.fetchAccount('example'), /network offline/);
  assert.equal(used.length, 4);
  assert.notEqual(used[2], used[3]);
  assert.deepEqual(settings.getX().cookies.map(cookie => cookie.status), ['valid', 'unchecked', 'unchecked']);
  database.close();
});
