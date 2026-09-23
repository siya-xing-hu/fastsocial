import type { AIServiceConfig, InteractionPrompt } from "./ai.ts";

export type XCookieStatus = "unchecked" | "valid" | "invalid";

/** A redacted X Cookie entry returned by the settings API. */
export interface XCookieConfig {
  id: string;
  name: string;
  enabled: boolean;
  cookieConfigured: boolean;
  status: XCookieStatus;
  lastCheckedAt?: string;
  lastError?: string;
}

/** An X Cookie entry accepted by the settings API. */
export interface XCookieInput {
  id: string;
  name: string;
  enabled: boolean;
  /** Omit this field to preserve the previously stored Cookie for the same id. */
  cookie?: string;
}

export interface XSettings {
  cookies: XCookieConfig[];
  cookieConfigured: boolean;
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
  x?: {
    cookies?: XCookieInput[];
    /** Legacy single-Cookie input kept for compatibility during migration. */
    cookie?: string;
  };
  telegram?: { botToken?: string; chatId?: string };
}
