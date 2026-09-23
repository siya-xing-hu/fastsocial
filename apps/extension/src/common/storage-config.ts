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

export const DEFAULT_TRANSLATE_PROMPT = `你是一名熟悉中英文互联网语境的翻译助手。请将下面的社交媒体内容翻译为 {targetLang}。

要求：
1. 忠实保留原意、语气、段落、标点与 emoji。
2. 人名、账号、产品名、链接、代码、缩写和业内常用术语可保留原文。
3. 表达自然，符合目标语言在社交媒体中的习惯，不要逐字硬译。
4. 不要补充原文没有的信息。

待翻译内容：
{userContent}`;

// 默认配置
const DEFAULT_CONFIG: Config = {
  basic: {
    translateProvider: TranslateChannelEnum.AUTO,
    targetLang: "zh-CN",
    autoTranslate: true,
  },
  translationService: {
    translatePrompt: DEFAULT_TRANSLATE_PROMPT,
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
  const storedTranslatePrompt = storedConfig.translationService?.translatePrompt;
  return {
    basic: {
      translateProvider: storedConfig.basic?.translateProvider ?? DEFAULT_CONFIG.basic.translateProvider,
      targetLang: storedConfig.basic?.targetLang ?? DEFAULT_CONFIG.basic.targetLang,
      autoTranslate: storedConfig.basic?.autoTranslate ?? DEFAULT_CONFIG.basic.autoTranslate,
    },
    translationService: {
      translatePrompt:
        typeof storedTranslatePrompt === "string" && storedTranslatePrompt.trim()
          ? storedTranslatePrompt
          : DEFAULT_TRANSLATE_PROMPT,
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
    const storedTranslatePrompt = parsed.translationService?.translatePrompt;
    if (
      parsed.aiServices !== undefined ||
      parsed.prompts !== undefined ||
      parsed.basic?.aiProvider !== undefined ||
      typeof storedTranslatePrompt !== "string" ||
      !storedTranslatePrompt.trim()
    ) {
      migrations["fast-social-config"] = JSON.stringify(config.value);
    }
  } else {
    config.value = mergeStoredConfig({});
    migrations["fast-social-config"] = JSON.stringify(config.value);
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
