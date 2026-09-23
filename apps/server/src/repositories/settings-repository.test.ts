import assert from "node:assert/strict";
import test from "node:test";
import { openDatabase } from "../db/database.ts";
import { SettingsRepository } from "./settings-repository.ts";

test("settings repository exposes default interaction prompts in priority order", () => {
  const database = openDatabase(":memory:");
  const repository = new SettingsRepository(database);

  assert.deepEqual(
    repository.getInteractionPrompts().map((prompt) => prompt.id),
    [
      "builtin-post-polish-en",
      "builtin-post-opinion-en",
      "builtin-post-concise-en",
      "builtin-reply-natural-en",
      "builtin-reply-question-en",
      "builtin-reply-agree-en",
      "builtin-reply-disagree-en",
    ],
  );
  assert.equal(repository.getInteractionPrompts().length, 7);

  repository.update({ interactionPrompts: [] });
  assert.deepEqual(repository.getInteractionPrompts(), []);
  database.close();
});

test("settings repository seeds a legacy empty prompt list once", () => {
  const database = openDatabase(":memory:");
  database.prepare("INSERT INTO settings (key, value) VALUES (?, ?)")
    .run("interaction_prompts", "[]");

  const firstRepository = new SettingsRepository(database);
  assert.equal(firstRepository.getInteractionPrompts().length, 7);

  firstRepository.update({ interactionPrompts: [] });
  const restartedRepository = new SettingsRepository(database);
  assert.deepEqual(restartedRepository.getInteractionPrompts(), []);
  database.close();
});

test("settings repository preserves secrets when omitted", () => {
  const database = openDatabase(":memory:");
  const repository = new SettingsRepository(database);

  repository.update({
    ai: {
      defaultProvider: "openai:gpt-test",
      services: [
        {
          id: "openai",
          name: "OpenAI",
          endpoint: "https://example.com/v1/chat/completions",
          apiKey: "secret",
          models: [{ name: "gpt-test" }],
          enabled: true,
        },
      ],
    },
    x: { cookie: "auth_token=test; ct0=csrf" },
    telegram: { botToken: "bot-secret", chatId: "42" },
  });

  repository.update({
    ai: {
      defaultProvider: "openai:gpt-test",
      services: [
        {
          id: "openai",
          name: "Renamed",
          endpoint: "https://example.com/v1/chat/completions",
          models: [{ name: "gpt-test" }],
          enabled: true,
        },
      ],
    },
    telegram: { chatId: "43" },
  });

  assert.equal(repository.getAI().services[0].apiKey, "secret");
  assert.equal(repository.getX().cookies[0]?.cookie, "auth_token=test; ct0=csrf");
  assert.equal(repository.getTelegram().botToken, "bot-secret");
  assert.equal(repository.getTelegram().chatId, "43");
  assert.deepEqual(repository.getPublic().x, {
    cookieConfigured: true,
    cookies: [{
      id: "legacy-default",
      name: "默认 Cookie",
      enabled: true,
      cookieConfigured: true,
      status: "unchecked",
    }],
  });
  database.close();
});

test("settings repository migrates a legacy X Cookie and never exposes its value", () => {
  const database = openDatabase(":memory:");
  database.prepare("INSERT INTO settings (key, value) VALUES (?, ?)")
    .run("x", JSON.stringify({ cookie: "auth_token=legacy; ct0=csrf" }));

  const repository = new SettingsRepository(database);
  assert.deepEqual(repository.getX(), {
    cookies: [{
      id: "legacy-default",
      name: "默认 Cookie",
      enabled: true,
      cookie: "auth_token=legacy; ct0=csrf",
      status: "unchecked",
    }],
  });
  assert.equal(JSON.stringify(repository.getPublic()).includes("auth_token=legacy"), false);
  database.close();
});

test("settings repository preserves Cookie secrets and resets status when changed", () => {
  const database = openDatabase(":memory:");
  const repository = new SettingsRepository(database);
  const original = "auth_token=first; ct0=csrf-1";

  repository.update({
    x: { cookies: [{ id: "primary", name: "主账号", enabled: true, cookie: original }] },
  });
  repository.updateXCookieStatus("primary", original, "invalid", "expired");
  repository.update({
    x: { cookies: [{ id: "primary", name: "重命名", enabled: false }] },
  });
  assert.deepEqual(repository.getX().cookies[0], {
    id: "primary",
    name: "重命名",
    enabled: false,
    cookie: original,
    status: "invalid",
    lastCheckedAt: repository.getX().cookies[0]?.lastCheckedAt,
    lastError: "expired",
  });

  const replacement = "auth_token=second; ct0=csrf-2";
  repository.update({
    x: { cookies: [{ id: "primary", name: "重命名", enabled: true, cookie: replacement }] },
  });
  assert.deepEqual(repository.getX().cookies[0], {
    id: "primary",
    name: "重命名",
    enabled: true,
    cookie: replacement,
    status: "unchecked",
  });
  assert.equal(repository.updateXCookieStatus("primary", original, "invalid", "stale"), false);
  assert.equal(repository.getX().cookies[0]?.status, "unchecked");
  database.close();
});
