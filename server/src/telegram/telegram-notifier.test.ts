import assert from "node:assert/strict";
import test from "node:test";
import { openDatabase } from "../db/database.ts";
import { SettingsRepository } from "../repositories/settings-repository.ts";
import { TelegramNotifier } from "./telegram-notifier.ts";

test("sends configured Telegram message", async () => {
  const database = openDatabase(":memory:");
  const settings = new SettingsRepository(database);
  settings.update({ telegram: { botToken: "token", chatId: "42" } });
  let request: { url: string; body: unknown } | undefined;
  const notifier = new TelegramNotifier(settings, async (input, init) => {
    request = { url: String(input), body: JSON.parse(String(init?.body)) };
    return new Response('{"ok":true}');
  });
  await notifier.send("matched");
  assert.equal(request?.url, "https://api.telegram.org/bottoken/sendMessage");
  assert.deepEqual(request?.body, { chat_id: "42", text: "matched", disable_web_page_preview: false });
  database.close();
});
