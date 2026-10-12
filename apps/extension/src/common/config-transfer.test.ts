import assert from "node:assert/strict";
import test from "node:test";
import { ConfigJsonError, parseBasicSettingsJson, serializeBasicSettings } from "./config-transfer.ts";

const document = () => ({
  version: 1,
  basic: { translateProvider: "ai", targetLang: "en", autoTranslate: false },
  translationService: {
    translatePrompt: "保留 emoji 🙂\n翻译 {userContent} 为 {targetLang}",
    deeplApiEndpoint: "https://api-free.deepl.com/v2/translate",
    fallbackDurationMinutes: 7,
  },
  apiKeys: { deepl: "example-key:fx" },
});

test("basic settings round-trip includes the DeepL key and preserves prompts and disabled preferences", () => {
  const source = document();
  const settings = parseBasicSettingsJson(JSON.stringify(source));
  assert.deepEqual(JSON.parse(serializeBasicSettings(settings)), source);
  assert.deepEqual(parseBasicSettingsJson(serializeBasicSettings(settings)), settings);
  assert.match(serializeBasicSettings(settings), /\n  "basic"/);
});

test("serialization only exports basic settings, not legacy server secrets or unrelated browser state", () => {
  const settings = parseBasicSettingsJson(JSON.stringify(document()));
  Object.assign(settings.config, { aiServices: [{ apiKey: "legacy-secret" }], prompts: ["server-prompt"] });
  Object.assign(settings.apiKeys, { telegram: "legacy-token" });
  assert.deepEqual(JSON.parse(serializeBasicSettings(settings)), document());
});

test("invalid syntax reports a useful error without echoing secret input", () => {
  assert.throws(() => parseBasicSettingsJson('{"apiKeys":{"deepl":"private-secret"},}'), error => {
    assert.ok(error instanceof ConfigJsonError);
    assert.match(error.message, /JSON 格式/);
    assert.doesNotMatch(error.message, /private-secret/);
    return true;
  });
  for (const text of ["", "null", "[]", '"text"', "42"]) {
    assert.throws(() => parseBasicSettingsJson(text), ConfigJsonError);
  }
});

test("import requires every field and rejects unsupported versions and misspelled fields", () => {
  const input = document();
  for (const [path, field] of [
    ["", "apiKeys"], ["", "version"], ["basic", "autoTranslate"],
    ["translationService", "translatePrompt"], ["apiKeys", "deepl"],
  ]) {
    const value = structuredClone(input) as Record<string, any>;
    delete (path ? value[path] : value)[field];
    assert.throws(() => parseBasicSettingsJson(JSON.stringify(value)), new RegExp(field));
  }
  assert.throws(() => parseBasicSettingsJson(JSON.stringify({ ...input, version: 2 })), /version/);
  assert.throws(() => parseBasicSettingsJson(JSON.stringify({ ...input, monitors: [] })), /monitors/);
  assert.throws(() => parseBasicSettingsJson(JSON.stringify({ ...input, basic: { ...input.basic, autoTranlsate: true } })), /autoTranlsate/);
});

test("import validates form values and will not coerce booleans, durations or keys", () => {
  const invalid: Array<[string, string, unknown]> = [
    ["basic", "translateProvider", "other"], ["basic", "targetLang", "invalid"],
    ["basic", "autoTranslate", "false"], ["basic", "autoTranslate", 0],
    ["translationService", "fallbackDurationMinutes", 0],
    ["translationService", "fallbackDurationMinutes", -1],
    ["translationService", "fallbackDurationMinutes", 1.5],
    ["translationService", "fallbackDurationMinutes", "5"],
    ["translationService", "fallbackDurationMinutes", Number.MAX_SAFE_INTEGER + 1],
    ["translationService", "deeplApiEndpoint", "https://example.com/translate"],
    ["translationService", "translatePrompt", null], ["apiKeys", "deepl", 123],
  ];
  for (const [section, field, value] of invalid) {
    const input = document() as Record<string, any>;
    input[section][field] = value;
    assert.throws(() => parseBasicSettingsJson(JSON.stringify(input)), new RegExp(`${section}\\.${field}`));
  }
});

test("all supported providers and intentional empty strings can be migrated", () => {
  for (const translateProvider of ["auto", "google", "deepl", "ai"]) {
    const input = document();
    input.basic.translateProvider = translateProvider;
    input.translationService.translatePrompt = "";
    input.apiKeys.deepl = "";
    assert.deepEqual(JSON.parse(serializeBasicSettings(parseBasicSettingsJson(JSON.stringify(input)))), input);
  }
});

test('translation template primary key and cached content survive browser export and import', () => {
  const snapshot = parseBasicSettingsJson(JSON.stringify({
    version: 1,
    basic: { translateProvider: 'ai', targetLang: 'en', autoTranslate: false },
    translationService: { promptId: 'primary-key', promptName: '任意模板', translatePrompt: '{input} {{_tl_}}', deeplApiEndpoint: 'https://api-free.deepl.com/v2/translate', fallbackDurationMinutes: 5 },
    apiKeys: { deepl: '' },
  }));
  assert.deepEqual(parseBasicSettingsJson(serializeBasicSettings(snapshot)), snapshot);
});
