import type { ApiKeys, Config } from "./storage-config.ts";

export interface BasicSettingsSnapshot {
  config: Config;
  apiKeys: ApiKeys;
}

export class ConfigJsonError extends Error {}

export function serializeBasicSettings({ config, apiKeys }: BasicSettingsSnapshot): string {
  return JSON.stringify({
    version: 1,
    basic: {
      translateProvider: config.basic.translateProvider,
      targetLang: config.basic.targetLang,
      autoTranslate: config.basic.autoTranslate,
    },
    translationService: {
      translatePrompt: config.translationService.translatePrompt,
      ...(config.translationService.promptId !== undefined ? { promptId: config.translationService.promptId, promptName: config.translationService.promptName ?? "" } : {}),
      deeplApiEndpoint: config.translationService.deeplApiEndpoint,
      fallbackDurationMinutes: config.translationService.fallbackDurationMinutes,
    },
    apiKeys: { deepl: apiKeys.deepl },
  }, null, 2);
}

export function parseBasicSettingsJson(text: string): BasicSettingsSnapshot {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    // JSON.parse errors can echo parts of the input, including the API key.
    throw new ConfigJsonError("JSON 格式不正确，请检查引号、逗号和括号。");
  }
  const root = object(value, "配置", ["version", "basic", "translationService", "apiKeys"]);
  if (root.version !== 1) throw new ConfigJsonError("version 必须为 1，请使用当前版本导出的配置。");
  const basic = object(root.basic, "basic", ["translateProvider", "targetLang", "autoTranslate"]);
  const translation = object(root.translationService, "translationService", ["translatePrompt", "deeplApiEndpoint", "fallbackDurationMinutes"], ["promptId", "promptName"]);
  const keys = object(root.apiKeys, "apiKeys", ["deepl"]);

  const provider = choice(basic.translateProvider, "basic.translateProvider", ["auto", "google", "deepl", "ai"]);
  const language = choice(basic.targetLang, "basic.targetLang", ["zh-CN", "en"]);
  if (typeof basic.autoTranslate !== "boolean") throw new ConfigJsonError("basic.autoTranslate 必须为 true 或 false。");
  const endpoint = choice(translation.deeplApiEndpoint, "translationService.deeplApiEndpoint", [
    "https://api.deepl.com/v2/translate",
    "https://api-free.deepl.com/v2/translate",
  ]);
  const duration = translation.fallbackDurationMinutes;
  if (typeof duration !== "number" || !Number.isSafeInteger(duration) || duration < 1) {
    throw new ConfigJsonError("translationService.fallbackDurationMinutes 必须为大于或等于 1 的整数。");
  }

  return {
    config: {
      basic: {
        translateProvider: provider as Config["basic"]["translateProvider"],
        targetLang: language,
        autoTranslate: basic.autoTranslate,
      },
      translationService: {
        ...(translation.promptId !== undefined ? { promptId: string(translation.promptId, "translationService.promptId"), promptName: string(translation.promptName ?? "", "translationService.promptName") } : {}),
        translatePrompt: string(translation.translatePrompt, "translationService.translatePrompt"),
        deeplApiEndpoint: endpoint,
        fallbackDurationMinutes: duration,
      },
    },
    apiKeys: { deepl: string(keys.deepl, "apiKeys.deepl") },
  };
}

function object(value: unknown, path: string, fields: string[], optional: string[] = []): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ConfigJsonError(`${path} 必须为 JSON 对象。`);
  }
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).find(key => !fields.includes(key) && !optional.includes(key));
  if (unknown !== undefined) throw new ConfigJsonError(`${path} 包含不支持的字段：${unknown}。`);
  const missing = fields.find(key => !Object.prototype.hasOwnProperty.call(record, key));
  if (missing) throw new ConfigJsonError(`${path} 缺少字段：${missing}。`);
  return record;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string") throw new ConfigJsonError(`${path} 必须为字符串。`);
  return value;
}

function choice(value: unknown, path: string, choices: string[]): string {
  if (typeof value !== "string" || !choices.includes(value)) {
    throw new ConfigJsonError(`${path} 只支持：${choices.join("、")}。`);
  }
  return value;
}
