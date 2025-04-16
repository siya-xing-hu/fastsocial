import { ref } from "vue";
import { debounce } from "../utils/kit";
import {
  ConfigUpdateRuntimeMessage,
  RuntimeMessageTypeEnum,
  sendRuntimeMessage,
} from "./runtime-message";

// 定义翻译渠道
export enum TranslateChannelEnum {
  GOOGLE = "google",
  DEEPL = "deepl",
  AI = "ai",
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

export interface ButtonConfigList {
  twitter: {
    post: ButtonConfig[];
    reply: ButtonConfig[];
    dm: ButtonConfig[];
  };
  producthunt: {
    reply: ButtonConfig[];
  };
}

interface Config {
  basic: {
    aiProvider: string; // 改为字符串，存储服务ID
    translateProvider: TranslateChannelEnum;
    targetLang: string;
    autoTranslate: boolean;
    translatePrompt: string; // 添加翻译 prompt 配置
  };
  aiServices: AIServiceConfig[];
  translationService: {
    deepl: {
      apiKey: string;
    };
  };
  buttons: ButtonConfigList;
}

// 默认配置
const DEFAULT_CONFIG: Config = {
  basic: {
    aiProvider: "ollama-default", // 默认使用Ollama
    translateProvider: TranslateChannelEnum.AI,
    targetLang: "zh-CN",
    autoTranslate: true,
    translatePrompt: "", // 添加默认翻译 prompt
  },
  aiServices: [
    {
      id: "openai-default",
      name: "OpenAI",
      endpoint: "https://api.openai.com/v1/chat/completions",
      apiKey: "",
      model: "gpt-4o-mini",
      customModels: ["gpt-3.5-turbo", "gpt-4o-mini"],
      enabled: false,
    },
    {
      id: "ollama-default",
      name: "Ollama",
      endpoint: "http://localhost:11434/v1/chat/completions",
      apiKey: "ollama",
      model: "llama3",
      customModels: ["llama3"],
      enabled: true,
    },
  ],
  translationService: {
    deepl: {
      apiKey: "",
    },
  },
  buttons: {
    twitter: {
      post: [
        {
          id: Date.now().toString(),
          name: "Translate",
          icon: "🌎",
          prompt: "翻译内容",
          enabled: true,
        },
      ],
      reply: [
        {
          id: Date.now().toString(),
          name: "Translate",
          icon: "🌎",
          prompt: "翻译内容",
          enabled: true,
        },
      ],
      dm: [
        {
          id: Date.now().toString(),
          name: "Translate",
          icon: "🌎",
          prompt: "翻译内容",
          enabled: true,
        },
      ],
    },
    producthunt: {
      reply: [
        {
          id: Date.now().toString(),
          name: "Translate",
          icon: "🌎",
          prompt: "翻译内容",
          enabled: true,
        },
      ],
    },
  },
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
  await chrome.storage.local.set({ ["fast-social-config"]: JSON.stringify(config.value) });

  const message: ConfigUpdateRuntimeMessage = {
    type: RuntimeMessageTypeEnum.CONFIG_UPDATE,
  };

  await sendRuntimeMessage(message);
}, 400);
