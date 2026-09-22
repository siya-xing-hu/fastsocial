import { ref } from "vue";
import { debounce } from "../utils/kit";
import {
  ConfigUpdateRuntimeMessage,
  RuntimeMessageTypeEnum,
  sendRuntimeMessage,
} from "./runtime-message";

export const promptScenes = ["post", "reply"] as const;
export type PromptScenes = typeof promptScenes[number];

// 定义翻译渠道
export enum TranslateChannelEnum {
  AUTO = "auto",
  AI = "ai",
  GOOGLE = "google",
  DEEPL = "deepl",
}

// 定义图标枚举
export enum IconEnum {
  "✨",
  "🌎",
  "💡",
  "💻",
  "✍️",
  "🔍",
  "🔧",
  "📚",
  "💬",
  "💼",
  "✈️",
  "⚽",
  "🎵",
  "🎨",
}

// API 密钥接口
export interface ApiKeys {
  deepl: string;
}

export interface PromptConfig {
  id: string;
  name: string;
  icon: string;
  prompt: string;
  enabled: boolean;
}

export interface Config {
  basic: {
    translateProvider: TranslateChannelEnum;
    targetLang: string;
    autoTranslate: boolean;
  };
  translationService: {
    translatePrompt: string; // 添加翻译 prompt 配置
    deeplApiEndpoint: string;
    fallbackDurationMinutes: number;
  };
}

// 默认配置
const DEFAULT_CONFIG: Config = {
  basic: {
    translateProvider: TranslateChannelEnum.GOOGLE,
    targetLang: "zh-CN",
    autoTranslate: true,
  },
  translationService: {
    translatePrompt: "", // 添加默认翻译 prompt
    deeplApiEndpoint: "https://api.deepl.com/v2/translate",
    fallbackDurationMinutes: 5,
  },
};

// 默认 API 密钥
const DEFAULT_API_KEYS: ApiKeys = {
  deepl: "",
};

export const config = ref<Config>(DEFAULT_CONFIG);
export const apiKeys = ref<ApiKeys>(DEFAULT_API_KEYS);

function mergeStoredConfig(storedConfig: Partial<Config>): Config {
  return {
    basic: {
      translateProvider: storedConfig.basic?.translateProvider ?? DEFAULT_CONFIG.basic.translateProvider,
      targetLang: storedConfig.basic?.targetLang ?? DEFAULT_CONFIG.basic.targetLang,
      autoTranslate: storedConfig.basic?.autoTranslate ?? DEFAULT_CONFIG.basic.autoTranslate,
    },
    translationService: {
      translatePrompt: storedConfig.translationService?.translatePrompt ?? DEFAULT_CONFIG.translationService.translatePrompt,
      deeplApiEndpoint: storedConfig.translationService?.deeplApiEndpoint ?? DEFAULT_CONFIG.translationService.deeplApiEndpoint,
      fallbackDurationMinutes: storedConfig.translationService?.fallbackDurationMinutes ?? DEFAULT_CONFIG.translationService.fallbackDurationMinutes,
    },
  };
}

function mergeStoredApiKeys(storedApiKeys: Partial<ApiKeys>): ApiKeys {
  return {
    deepl: storedApiKeys.deepl ?? DEFAULT_API_KEYS.deepl,
  };
}

// 修改初始化函数，分别获取配置和 API 密钥
export async function initConfig() {
  const storage = await chrome.storage.local.get();
  const storedConfig = storage["fast-social-config"];
  const storedApiKeys = storage["fast-social-api-keys"];
  const migrations: Record<string, string> = {};

  if (storedConfig) {
    const parsed = JSON.parse(storedConfig) as Partial<Config> & {
      aiServices?: unknown;
      prompts?: unknown;
      basic?: Config["basic"] & { aiProvider?: unknown };
    };
    config.value = mergeStoredConfig(parsed);
    if (parsed.aiServices !== undefined || parsed.prompts !== undefined || parsed.basic?.aiProvider !== undefined) {
      migrations["fast-social-config"] = JSON.stringify(config.value);
    }
  }

  if (storedApiKeys) {
    const parsed = JSON.parse(storedApiKeys) as Partial<ApiKeys> & { aiServices?: unknown };
    apiKeys.value = mergeStoredApiKeys(parsed);
    if (parsed.aiServices !== undefined) {
      migrations["fast-social-api-keys"] = JSON.stringify(apiKeys.value);
    }
  }

  if (Object.keys(migrations).length > 0) {
    await chrome.storage.local.set(migrations);
  }
}

// 保存配置
export const saveConfig = debounce(async () => {
  await chrome.storage.local.set({
    ["fast-social-config"]: JSON.stringify(config.value),
  });

  const message: ConfigUpdateRuntimeMessage = {
    type: RuntimeMessageTypeEnum.CONFIG_UPDATE,
  };

  await sendRuntimeMessage(message);
}, 400);

// 保存 API 密钥
export const saveApiKeys = debounce(async () => {
  await chrome.storage.local.set({
    ["fast-social-api-keys"]: JSON.stringify(apiKeys.value),
  });

  const message: ConfigUpdateRuntimeMessage = {
    type: RuntimeMessageTypeEnum.CONFIG_UPDATE,
  };

  await sendRuntimeMessage(message);
}, 400);

// 为了兼容性保留原有函数名
export const onInput = saveConfig;

// 获取 DeepL API 密钥
export function getDeeplApiKey(): string {
  return apiKeys.value.deepl || "";
}

// 设置 DeepL API 密钥
export function setDeeplApiKey(key: string) {
  apiKeys.value.deepl = key;
  saveApiKeys();
}
