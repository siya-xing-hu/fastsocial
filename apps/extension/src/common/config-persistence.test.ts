import assert from "node:assert/strict";
import test from "node:test";
import { createConfigPersistence } from "./config-persistence.ts";
import { parseBasicSettingsJson, serializeBasicSettings } from "./config-transfer.ts";

function snapshot(key: string) {
  return parseBasicSettingsJson(JSON.stringify({
    version: 1,
    basic: { translateProvider: "google", targetLang: "zh-CN", autoTranslate: true },
    translationService: {
      translatePrompt: "{userContent}",
      deeplApiEndpoint: "https://api.deepl.com/v2/translate",
      fallbackDurationMinutes: 5,
    },
    apiKeys: { deepl: key },
  }));
}

test("JSON import writes both storage values together before applying or notifying", async () => {
  let current = snapshot("old-key");
  const next = snapshot("new-key");
  const stored: Record<string, string> = { unrelated: "retained" };
  const order: string[] = [];
  const persistence = createConfigPersistence({
    read: () => current,
    write: async values => {
      order.push("write");
      assert.equal(current.apiKeys.deepl, "old-key");
      assert.deepEqual(Object.keys(values).sort(), ["fast-social-api-keys", "fast-social-config"]);
      Object.assign(stored, values);
    },
    apply: value => { order.push("apply"); current = value; },
    notify: async () => {
      order.push("notify");
      assert.deepEqual(current, next);
      assert.deepEqual(JSON.parse(stored["fast-social-api-keys"]), next.apiKeys);
    },
  });
  assert.equal(await persistence.importJson(serializeBasicSettings(next)), true);
  assert.deepEqual(order, ["write", "apply", "notify"]);
  assert.equal(stored.unrelated, "retained");
});

test("invalid or failed imports leave current state intact and allow a later retry", async () => {
  const original = snapshot("old-key");
  let current = original;
  let failWrite = true;
  let writes = 0;
  let notifications = 0;
  const persistence = createConfigPersistence({
    read: () => current,
    write: async () => { writes++; if (failWrite) throw new Error("storage failed"); },
    apply: value => { current = value; },
    notify: async () => { notifications++; },
  });
  await assert.rejects(persistence.importJson("{}"));
  assert.equal(writes, 0);
  const text = serializeBasicSettings(snapshot("new-key"));
  await assert.rejects(persistence.importJson(text), /storage failed/);
  assert.equal(current, original);
  assert.equal(notifications, 0);
  failWrite = false;
  await persistence.importJson(text);
  assert.equal(current.apiKeys.deepl, "new-key");
  assert.equal(notifications, 1);
});

test("queued and delayed form saves cannot put old values back after an import", async () => {
  let current = snapshot("old-key");
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void;
  const firstWrite = new Promise<void>(resolve => { started = resolve; });
  let writes = 0;
  const stored: Record<string, string> = {};
  const persistence = createConfigPersistence({
    read: () => current,
    write: async values => {
      if (++writes === 1) { started(); await gate; }
      Object.assign(stored, values);
    },
    apply: value => { current = value; },
    notify: async () => {},
  });
  const oldSave = persistence.saveConfig();
  await firstWrite;
  const next = snapshot("new-key");
  next.config.basic.autoTranslate = false;
  const imported = persistence.importJson(serializeBasicSettings(next));
  const delayedKeySave = persistence.saveApiKeys();
  const delayedConfigSave = persistence.saveConfig();
  release();
  await Promise.all([oldSave, imported, delayedKeySave, delayedConfigSave]);
  assert.deepEqual(JSON.parse(stored["fast-social-config"]), next.config);
  assert.deepEqual(JSON.parse(stored["fast-social-api-keys"]), next.apiKeys);
});

test("a failed tab notification reports saved state instead of pretending storage failed", async () => {
  let current = snapshot("old-key");
  const persistence = createConfigPersistence({
    read: () => current,
    write: async () => {},
    apply: value => { current = value; },
    notify: async () => { throw new Error("background unavailable"); },
  });
  assert.equal(await persistence.importJson(serializeBasicSettings(snapshot("new-key"))), false);
  assert.equal(current.apiKeys.deepl, "new-key");
});
