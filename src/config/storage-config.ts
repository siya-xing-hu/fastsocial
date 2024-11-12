import { ref } from "vue";
import { debounce } from "../utils/common";
import { ConfigUpdateRuntimeMessage, RuntimeMessageTypeEnum, sendRuntimeMessage } from "../common/runtime-message";

export interface ShortcutConfig {
  ctrl: boolean;
  shift: boolean;
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

interface Config {
  basic: {
    aiProvider: 'chatgpt' | 'ollama';
    provider: 'google' | 'deepl' | 'chatgpt' | 'ollama';
    targetLang: string;
    autoTranslate: boolean;
    shortcut: ShortcutConfig;
  };
  aiService: {
    openai: OpenAIConfig;
    ollama: OllamaConfig;
    deepl: DeepLConfig;
  };
}

// 默认配置
const DEFAULT_CONFIG: Config = {
  basic: {
    aiProvider: 'ollama',
    provider: 'google',
    targetLang: 'zh-CN',
    autoTranslate: false,
    shortcut: {
      ctrl: true,
      shift: true,
    }
  },
  aiService: {
    openai: {
      apiKey: '',
      model: 'gpt-3.5-turbo'
    },
    ollama: {
      endpoint: 'http://localhost:11434',
      model: 'llama3',
      customModels: []
    },
    deepl: {
      apiKey: ''
    }
  }
};

export const config = ref<Config>(DEFAULT_CONFIG);

// 初始化 OpenAI 函数
export async function initConfig() {
  const storage = await chrome.storage.local.get()
  config.value = storage["config"] ?? DEFAULT_CONFIG;
}

export const onInput = debounce(async () => {

  await chrome.storage.local.set({ ['config']: config.value });

  const message: ConfigUpdateRuntimeMessage = {
    type: RuntimeMessageTypeEnum.CONFIG_UPDATE,
  };

  await sendRuntimeMessage(message);
}, 400);
