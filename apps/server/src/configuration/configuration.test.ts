import { XRequestQueue } from '../adapters/x/request-queue.ts';
import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../app.ts";
import { openDatabase } from "../db/database.ts";
import { SettingsRepository } from "../repositories/settings-repository.ts";

const cookie = (id: string) =>
  `auth_token=secret-${id}; ct0=csrf; twid=u%3D${id}`;
test("account and prompt associations are bidirectional, isolated and retained across repository restart", () => {
  const db = openDatabase(":memory:"),
    settings = new SettingsRepository(db),
    repo = settings.configuration;
  const en = repo.saveAccount({
    name: "English",
    username: "global",
    cookie: cookie("1"),
    configIds: ["auto-translate"],
  });
  const cn = repo.saveAccount({
    name: "中文",
    username: "local",
    cookie: cookie("2"),
    configIds: [],
  });
  const prompt = repo.savePrompt({
    name: "观点",
    scene: "reply",
    prompt: "{input} / {reply} / {{_tl_}}",
    accountIds: [cn.id],
  });
  assert.ok(
    repo
      .accounts()
      .find((a) => a.id === cn.id)
      ?.configIds.includes(prompt.id)
  );
  assert.deepEqual(repo.resolve("1", "local").prompts, []);
  assert.equal(repo.resolve("1", "global").autoTranslate, true);
  assert.equal(repo.resolve("2", "local").autoTranslate, false);
  assert.equal(repo.resolve("2", "local").prompts[0]?.id, prompt.id);
  assert.deepEqual(repo.resolve("unknown", "global"), {
    accountId: null,
    autoTranslate: false,
    prompts: [],
  });
  repo.saveAccount(
    { name: "English", username: "global", configIds: [prompt.id] },
    en.id
  );
  assert.deepEqual(
    new Set(repo.prompts().find((p) => p.id === prompt.id)?.accountIds),
    new Set([en.id, cn.id])
  );
  const restarted = new SettingsRepository(db);
  assert.equal(
    restarted.configuration.resolve("1", "").prompts[0]?.id,
    prompt.id
  );
  assert.equal(JSON.stringify(settings.getPublic()).includes("secret-"), false);
  assert.equal(repo.cookies().find((a) => a.id === en.id)?.cookie, cookie("1"));
  assert.throws(() =>
    repo.saveAccount(
      { name: "bad", username: "global", configIds: ["missing"] },
      en.id
    )
  );
  assert.equal(repo.accounts().find((a) => a.id === en.id)?.name, "English");
  repo.deleteAccount(cn.id);
  assert.ok(repo.prompts().some((p) => p.id === prompt.id));
  repo.deletePrompt(prompt.id);
  assert.deepEqual(repo.accounts()[0]?.configIds, []);
  db.close();
});
test("copies existing cookie and prompt configuration into relational tables without enabling account mappings", () => {
  const db = openDatabase(":memory:");
  db.prepare("INSERT INTO settings VALUES (?,?)").run(
    "x",
    JSON.stringify({
      cookies: [
        {
          id: "old-cookie",
          name: "旧账号",
          cookie: cookie("7"),
          enabled: true,
          status: "valid",
        },
      ],
    })
  );
  db.prepare("INSERT INTO settings VALUES (?,?)").run(
    "interaction_prompts",
    JSON.stringify([
      {
        id: "old-prompt",
        name: "旧模板",
        scene: "reply",
        enabled: true,
        prompt: "{userContent} {replyContent} {targetLang}",
      },
    ])
  );
  const repo = new SettingsRepository(db).configuration;
  assert.equal(repo.cookies()[0]?.cookie, cookie("7"));
  assert.equal(repo.prompts()[0]?.prompt, "{input} {reply} {{_tl_}}");
  assert.deepEqual(repo.accounts()[0]?.configIds, []);
  db.close();
});
test("API generates primary keys and validates associations atomically", async () => {
  const app = createApp({ xRequestQueue: new XRequestQueue({ intervalMs: 0 }) });
  const account = await app.inject({
    method: "POST",
    url: "/api/accounts",
    payload: {
      name: "账号",
      username: "tester",
      cookie: cookie("5"),
      configIds: [],
    },
  });
  assert.equal(account.statusCode, 200);
  const id = account.json().data.id;
  const prompt = await app.inject({
    method: "POST",
    url: "/api/prompts",
    payload: {
      name: "测试",
      scene: "reply",
      prompt: "{input}",
      accountIds: [id],
    },
  });
  assert.equal(prompt.statusCode, 200);
  assert.ok(prompt.json().data.id);
  const bad = await app.inject({
    method: "PUT",
    url: `/api/prompts/${prompt.json().data.id}`,
    payload: {
      name: "错误修改",
      scene: "reply",
      prompt: "oops",
      accountIds: ["missing"],
    },
  });
  assert.equal(bad.statusCode, 400);
  const config = await app.inject({ url: "/api/account-config?actorId=5" });
  assert.equal(config.json().data.prompts[0].name, "测试");
  const missing = await app.inject({
    method: "PUT",
    url: "/api/accounts/no-such-id",
    payload: {},
  });
  assert.equal(missing.statusCode, 404);
  await app.close();
});

test("refreshing a Cookie cannot silently replace the account identity", () => {
  const db = openDatabase(":memory:");
  const repo = new SettingsRepository(db).configuration;
  const a = repo.saveAccount({
    name: "Account",
    username: "same_name",
    cookie: cookie("9"),
    configIds: ["auto-translate"],
  });
  assert.throws(
    () =>
      repo.saveAccount(
        {
          name: "Account",
          username: "same_name",
          cookie: cookie("8"),
          configIds: [],
        },
        a.id
      ),
    /Cookie 不属于此账号/
  );
  assert.equal(repo.accounts()[0]?.actorId, "9");
  assert.equal(repo.resolve("9", "").autoTranslate, true);
  db.close();
});
