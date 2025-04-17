import { ref } from "vue";
import { debounce } from "../utils/kit";
import {
  ConfigUpdateRuntimeMessage,
  RuntimeMessageTypeEnum,
  sendRuntimeMessage,
} from "./runtime-message";

// 定义翻译渠道
export enum TranslateChannelEnum {
  AI = "ai",
  GOOGLE = "google",
  DEEPL = "deepl",
}

// 定义按钮图标枚举
export enum ButtonIconEnum {
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
  "🎨"
}

// AI服务配置接口
export interface AIServiceConfig {
  id: string;
  name: string;
  endpoint: string;
  apiKey?: string;
  model: string;
  customModels?: string[];
  enabled: boolean;
}

export interface ButtonConfig {
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
    deepl: {
      apiKey: string;
    };
  };
  buttons: ButtonConfig[];
}

// 默认配置
const DEFAULT_CONFIG: Config = {
  basic: {
    aiProvider: "ollama-default",
    translateProvider: TranslateChannelEnum.GOOGLE,
    targetLang: "zh-CN",
    autoTranslate: true,
  },
  aiServices: [
    {
      id: "ollama-default",
      name: "Ollama",
      endpoint: "http://localhost:11434/v1/chat/completions",
      apiKey: "ollama",
      model: "llama3",
      customModels: ["llama3"],
      enabled: true,
    },
    {
      id: "gemini-default",
      name: "Gemini",
      endpoint:
        "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      apiKey: "",
      model: "gemini-2.0-flash",
      customModels: ["gemini-2.0-flash"],
      enabled: true,
    },
    {
      id: "openai-default",
      name: "OpenAI",
      endpoint: "https://api.openai.com/v1/chat/completions",
      apiKey: "",
      model: "gpt-4o-mini",
      customModels: ["gpt-3.5-turbo", "gpt-4o-mini"],
      enabled: false,
    },
  ],
  translationService: {
    translatePrompt: "", // 添加默认翻译 prompt
    deepl: {
      apiKey: "",
    },
  },
  buttons: [
    {
      id: `custom-${Date.now()}`,
      name: "翻译",
      icon: "🌎",
      prompt: "请将以下文本翻译成英文, 直接输出翻译结果，不要过度解读。翻译要求：1. 保持专业术语的准确性；2. 保持原文的语气和风格；3. 确保翻译的流畅性和自然度。",
      enabled: true,
    },
  ],
};

export const config = ref<Config>(DEFAULT_CONFIG);

// 修改初始化函数
export async function initConfig() {
  const storage = await chrome.storage.local.get();
  const storedConfig = storage["fast-social-config"];

  if (storedConfig) {
    config.value = JSON.parse(storedConfig);
  }
}

export const onInput = debounce(async () => {
  await chrome.storage.local.set({
    ["fast-social-config"]: JSON.stringify(config.value),
  });

  const message: ConfigUpdateRuntimeMessage = {
    type: RuntimeMessageTypeEnum.CONFIG_UPDATE,
  };

  await sendRuntimeMessage(message);
}, 400);
