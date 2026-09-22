import assert from "node:assert/strict";
import test from "node:test";
import { openDatabase } from "../db/database.ts";
import { SettingsRepository } from "./settings-repository.ts";

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
  assert.equal(repository.getX().cookie, "auth_token=test; ct0=csrf");
  assert.equal(repository.getTelegram().botToken, "bot-secret");
  assert.equal(repository.getTelegram().chatId, "43");
  assert.deepEqual(repository.getPublic().x, { cookieConfigured: true });
  database.close();
});
