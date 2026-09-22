import type { AIServiceConfig, InteractionPrompt } from "./ai.ts";

export interface XSettings {
  cookie?: string;
  cookieConfigured?: boolean;
}

export interface TelegramSettings {
  botToken?: string;
  botTokenConfigured?: boolean;
  chatId: string;
}

export interface AISettings {
  services: AIServiceConfig[];
  defaultProvider: string;
}

export interface ServerSettings {
  ai: AISettings;
  interactionPrompts: InteractionPrompt[];
  x: XSettings;
  telegram: TelegramSettings;
}

export interface ServerSettingsPatch {
  ai?: AISettings;
  interactionPrompts?: InteractionPrompt[];
  x?: { cookie?: string };
  telegram?: { botToken?: string; chatId?: string };
}
