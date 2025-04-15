import { ref } from "vue";
import { debounce } from "../utils/kit";
import { ConfigUpdateRuntimeMessage, RuntimeMessageTypeEnum, sendRuntimeMessage } from "./runtime-message";

// 定义翻译渠道
export enum TranslateChannelEnum {
  GOOGLE = "google",
  DEEPL = "deepl",
  CHATGPT = "chatgpt",
  OLLAMA = "ollama",
}

// 定义AI服务
export enum AIServiceEnum {
  OPENAI = "openai",
  OLLAMA = "ollama",
}

export interface OpenAIConfig {
  apiKey: string;
  org?: string;
  model: string;
}

export interface OllamaConfig {
  endpoint: string;
  model: string;
  customModels: string[];
}

export interface DeepLConfig {
  apiKey: string;
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
    aiProvider: AIServiceEnum;
    translateProvider: TranslateChannelEnum;
    targetLang: string;
    autoTranslate: boolean;
  };
  aiService: {
    openai: OpenAIConfig;
    ollama: OllamaConfig;
    deepl: DeepLConfig;
  };
  buttons: ButtonConfigList;
}

// 默认配置
const DEFAULT_CONFIG: Config = {
  basic: {
    aiProvider: AIServiceEnum.OLLAMA,
    translateProvider: TranslateChannelEnum.OLLAMA,
    targetLang: 'zh-CN',
    autoTranslate: true
  },
  aiService: {
    openai: {
      apiKey: '',
      model: 'gpt-4o'
    },
    ollama: {
      endpoint: 'http://localhost:11434',
      model: 'llama3',
      customModels: []
    },
    deepl: {
      apiKey: ''
    }
  },
  buttons: {
    twitter: {
      post: [
        {
          id: Date.now().toString(),
          name: 'Translate',
          icon: '🌎',
          prompt: '翻译内容',
          enabled: true
        }
      ],
      reply: [
        {
          id: Date.now().toString(),
          name: 'Translate',
          icon: '🌎',
          prompt: '翻译内容',
          enabled: true
        }
      ],
      dm: [
        {
          id: Date.now().toString(),
          name: 'Translate',
          icon: '🌎',
          prompt: '翻译内容',
          enabled: true
        }
      ]
    },
    producthunt: {
      reply: [
        {
          id: Date.now().toString(),
          name: 'Translate',
          icon: '🌎',
          prompt: '翻译内容',
          enabled: true
        }
      ],
    }
  }
};

export const config = ref<Config>(DEFAULT_CONFIG);

// 添加深度合并函数
function deepMerge<T extends { [key: string]: any }>(target: T, source: Partial<T>): T {
  const result = { ...target };
  
  for (const key in source) {
    const sourceValue = source[key];
    const targetValue = target[key];
    
    if (sourceValue !== undefined) {
      if (Array.isArray(sourceValue)) {
        // 确保数组属性被正确复制
        result[key] = [...sourceValue] as T[Extract<keyof T, string>];
      } else if (sourceValue && typeof sourceValue === 'object' && targetValue && typeof targetValue === 'object') {
        result[key] = deepMerge(
          targetValue as { [key: string]: any },
          sourceValue as { [key: string]: any }
        ) as T[Extract<keyof T, string>];
      } else {
        result[key] = sourceValue as T[Extract<keyof T, string>];
      }
    }
  }
  
  return result;
}

// 修改初始化函数
export async function initConfig() {
  const storage = await chrome.storage.local.get();
  const storedConfig = storage["config"];
  
  if (storedConfig) {
    // 将存储的配置与默认配置进行深度合并
    config.value = deepMerge(DEFAULT_CONFIG, storedConfig);
  } else {
    config.value = DEFAULT_CONFIG;
  }
}

export const onInput = debounce(async () => {

  await chrome.storage.local.set({ ['config']: config.value });

  const message: ConfigUpdateRuntimeMessage = {
    type: RuntimeMessageTypeEnum.CONFIG_UPDATE,
  };

  await sendRuntimeMessage(message);
}, 400);
