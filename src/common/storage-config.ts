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
  aiServices: Record<string, string>; // serviceId -> apiKey
  deepl: string;
}

// AI服务配置接口
export interface AIServiceConfig {
  id: string;
  name: string;
  endpoint: string;
  customModels?: string[];
  enabled: boolean;
}

export interface PromptConfig {
  id: string;
  name: string;
  icon: string;
  prompt: string;
  enabled: boolean;
}

interface Config {
  basic: {
    aiProvider: string; // 改为字符串，存储服务ID
    translateProvider: TranslateChannelEnum;
    targetLang: string;
    autoTranslate: boolean;
  };
  aiServices: AIServiceConfig[];
  translationService: {
    translatePrompt: string; // 添加翻译 prompt 配置
  };
  prompts: {
    post: PromptConfig[];
    reply: PromptConfig[];
  };
}

// 默认配置
const DEFAULT_CONFIG: Config = {
  basic: {
    aiProvider: "ollama-default:llama3", // 存储格式改为 "serviceId:modelName"
    translateProvider: TranslateChannelEnum.GOOGLE,
    targetLang: "zh-CN",
    autoTranslate: true,
  },
  aiServices: [
    {
      id: "ollama-default",
      name: "Ollama",
      endpoint: "http://localhost:11434/v1/chat/completions",
      customModels: ["llama3"],
      enabled: true,
    },
    {
      id: "gemini-default",
      name: "Gemini",
      endpoint:
        "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      customModels: ["gemini-2.0-flash"],
      enabled: true,
    },
    {
      id: "openai-default",
      name: "OpenAI",
      endpoint: "https://api.openai.com/v1/chat/completions",
      customModels: ["gpt-3.5-turbo", "gpt-4o-mini"],
      enabled: false,
    },
  ],
  translationService: {
    translatePrompt: "", // 添加默认翻译 prompt
  },
  prompts: {
    post: [
      {
        id: `post-${Date.now()}`,
        name: "翻译",
        icon: "🌎",
        prompt: `请将文本内容
          ''' 
          {userContent} 
          ''' 
翻译成英文。翻译要求：1. 保持原文的语气和风格；2. 确保翻译的流畅性和自然度；3. 直接输出翻译结果，不要输出解析思考。`,
        enabled: true,
      },
    ],
    reply: [
      {
        id: `reply-${Date.now()}`,
        name: "翻译",
        icon: "🌎",
        prompt: `请将文本内容
          ''' 
          {userContent} 
          ''' 
翻译成英文。翻译要求：1. 保持原文的语气和风格；2. 确保翻译的流畅性和自然度；3. 直接输出翻译结果，不要输出解析思考。`,
        enabled: true,
      },
    ],
  },
};

// 默认 API 密钥
const DEFAULT_API_KEYS: ApiKeys = {
  aiServices: {
    "ollama-default": "ollama",
    "gemini-default": "",
    "openai-default": "",
  },
  deepl: "",
};

export const config = ref<Config>(DEFAULT_CONFIG);
export const apiKeys = ref<ApiKeys>(DEFAULT_API_KEYS);

// 修改初始化函数，分别获取配置和 API 密钥
export async function initConfig() {
  const storage = await chrome.storage.local.get();
  const storedConfig = storage["fast-social-config"];
  const storedApiKeys = storage["fast-social-api-keys"];

  if (storedConfig) {
    config.value = JSON.parse(storedConfig);
  }

  if (storedApiKeys) {
    apiKeys.value = JSON.parse(storedApiKeys);
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

// 获取指定服务的 API 密钥
export function getServiceApiKey(serviceId: string): string {
  return apiKeys.value.aiServices[serviceId] || "";
}

// 获取 DeepL API 密钥
export function getDeeplApiKey(): string {
  return apiKeys.value.deepl || "";
}

// 设置服务的 API 密钥
export function setServiceApiKey(serviceId: string, key: string) {
  apiKeys.value.aiServices[serviceId] = key;
  saveApiKeys();
}

// 设置 DeepL API 密钥
export function setDeeplApiKey(key: string) {
  apiKeys.value.deepl = key;
  saveApiKeys();
}
