import type { DatabaseSync } from "node:sqlite";
import type {
  AIServiceConfig,
  AISettings,
  InteractionPrompt,
  ServerSettings,
  ServerSettingsPatch,
  TelegramSettings,
  XCookieInput,
  XCookieStatus,
} from "@fast-social/contracts";
import { DEFAULT_INTERACTION_PROMPTS } from "../default-interaction-prompts.ts";

const DEFAULT_AI: AISettings = { services: [], defaultProvider: "" };
const DEFAULT_X: StoredXSettings = { cookies: [] };
const DEFAULT_TELEGRAM: TelegramSettings = { chatId: "" };
const LEGACY_X_COOKIE_ID = "legacy-default";

export interface StoredXCookie extends XCookieInput {
  status: XCookieStatus;
  lastCheckedAt?: string;
  lastError?: string;
}

export interface StoredXSettings {
  cookies: StoredXCookie[];
}

interface LegacyXSettings {
  cookie?: string;
  cookies?: StoredXCookie[];
}

type SettingsKey =
  | "ai"
  | "interaction_prompts"
  | "interaction_prompts_seeded"
  | "x"
  | "telegram";

export class SettingsRepository {
  private readonly database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.database = database;
    this.migrateLegacyXSettings();
    this.seedInteractionPromptsOnce();
  }

  getPublic(): ServerSettings {
    const ai = this.getValue<AISettings>("ai", DEFAULT_AI);
    const x = this.getX();
    const telegram = this.getValue<TelegramSettings>("telegram", DEFAULT_TELEGRAM);
    const interactionPrompts = this.getValue<InteractionPrompt[]>(
      "interaction_prompts",
      DEFAULT_INTERACTION_PROMPTS,
    );

    return {
      ai: {
        defaultProvider: ai.defaultProvider,
        services: ai.services.map(({ apiKey, ...service }) => ({
          ...service,
          apiKeyConfigured: Boolean(apiKey),
        })),
      },
      interactionPrompts,
      x: {
        cookies: x.cookies.map(({ cookie, ...entry }) => ({
          ...entry,
          cookieConfigured: Boolean(cookie?.trim()),
        })),
        cookieConfigured: x.cookies.some((entry) => Boolean(entry.cookie?.trim())),
      },
      telegram: {
        chatId: telegram.chatId,
        botTokenConfigured: Boolean(telegram.botToken),
      },
    };
  }

  getAI(): AISettings {
    return this.getValue<AISettings>("ai", DEFAULT_AI);
  }

  getX(): StoredXSettings {
    return this.getValue<StoredXSettings>("x", DEFAULT_X);
  }

  getTelegram(): TelegramSettings {
    return this.getValue<TelegramSettings>("telegram", DEFAULT_TELEGRAM);
  }

  getInteractionPrompts(): InteractionPrompt[] {
    return this.getValue<InteractionPrompt[]>(
      "interaction_prompts",
      DEFAULT_INTERACTION_PROMPTS,
    );
  }

  update(patch: ServerSettingsPatch): ServerSettings {
    if (patch.ai) {
      const current = this.getAI();
      const services = patch.ai.services.map((service) =>
        this.mergeAIServiceSecret(service, current.services),
      );
      this.setValue("ai", { ...patch.ai, services });
    }

    if (patch.interactionPrompts) {
      this.setValue("interaction_prompts", patch.interactionPrompts);
    }

    if (patch.x) {
      if (patch.x.cookies) {
        const current = this.getX().cookies;
        this.setValue("x", {
          cookies: patch.x.cookies.map((entry) =>
            this.mergeXCookieSecret(entry, current),
          ),
        } satisfies StoredXSettings);
      } else if (patch.x.cookie !== undefined) {
        this.updateLegacyXCookie(patch.x.cookie);
      }
    }

    if (patch.telegram) {
      this.setValue("telegram", {
        ...this.getTelegram(),
        ...patch.telegram,
      });
    }

    return this.getPublic();
  }

  private mergeAIServiceSecret(
    service: AIServiceConfig,
    currentServices: AIServiceConfig[],
  ): AIServiceConfig {
    if (service.apiKey !== undefined) return service;
    const current = currentServices.find((item) => item.id === service.id);
    return current?.apiKey ? { ...service, apiKey: current.apiKey } : service;
  }

  updateXCookieStatus(
    id: string,
    expectedCookie: string,
    status: XCookieStatus,
    lastError?: string,
  ): boolean {
    const current = this.getX();
    const index = current.cookies.findIndex((entry) => entry.id === id);
    if (index < 0 || current.cookies[index]?.cookie !== expectedCookie) return false;

    const cookies = current.cookies.map((entry, entryIndex) =>
      entryIndex === index
        ? {
            ...entry,
            status,
            lastCheckedAt: new Date().toISOString(),
            ...(lastError ? { lastError } : { lastError: undefined }),
          }
        : entry,
    );
    this.setValue("x", { cookies } satisfies StoredXSettings);
    return true;
  }

  private mergeXCookieSecret(
    input: XCookieInput,
    currentCookies: StoredXCookie[],
  ): StoredXCookie {
    const current = currentCookies.find((entry) => entry.id === input.id);
    const cookie = input.cookie === undefined ? current?.cookie : input.cookie;
    const cookieChanged = input.cookie !== undefined && input.cookie !== current?.cookie;

    return {
      id: input.id,
      name: input.name,
      enabled: input.enabled,
      ...(cookie !== undefined ? { cookie } : {}),
      status: cookieChanged ? "unchecked" : (current?.status ?? "unchecked"),
      ...(!cookieChanged && current?.lastCheckedAt
        ? { lastCheckedAt: current.lastCheckedAt }
        : {}),
      ...(!cookieChanged && current?.lastError
        ? { lastError: current.lastError }
        : {}),
    };
  }

  private updateLegacyXCookie(cookie: string): void {
    const current = this.getX().cookies;
    const existing = current.find((entry) => entry.id === LEGACY_X_COOKIE_ID);
    const replacement = this.mergeXCookieSecret(
      {
        id: LEGACY_X_COOKIE_ID,
        name: "默认 Cookie",
        enabled: true,
        cookie,
      },
      current,
    );
    this.setValue("x", {
      cookies: existing
        ? current.map((entry) => entry.id === LEGACY_X_COOKIE_ID ? replacement : entry)
        : [...current, replacement],
    } satisfies StoredXSettings);
  }

  private migrateLegacyXSettings(): void {
    const stored = this.getValue<LegacyXSettings>("x", {});
    if (Array.isArray(stored.cookies)) {
      const cookies = stored.cookies.map((entry) => ({
        ...entry,
        enabled: entry.enabled ?? true,
        status: entry.status ?? "unchecked",
      }));
      if ("cookie" in stored || JSON.stringify(cookies) !== JSON.stringify(stored.cookies)) {
        this.setValue("x", { cookies } satisfies StoredXSettings);
      }
      return;
    }

    const cookie = stored.cookie?.trim();
    if (!cookie) return;
    this.setValue("x", {
      cookies: [{
        id: LEGACY_X_COOKIE_ID,
        name: "默认 Cookie",
        enabled: true,
        cookie,
        status: "unchecked",
      }],
    } satisfies StoredXSettings);
  }

  private seedInteractionPromptsOnce(): void {
    if (this.getValue<boolean>("interaction_prompts_seeded", false)) return;

    const existing = this.getValue<InteractionPrompt[]>("interaction_prompts", []);
    if (existing.length === 0) {
      this.setValue("interaction_prompts", DEFAULT_INTERACTION_PROMPTS);
    }
    this.setValue("interaction_prompts_seeded", true);
  }

  private getValue<T>(key: SettingsKey, fallback: T): T {
    const row = this.database
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(key) as { value?: string } | undefined;
    if (!row?.value) return structuredClone(fallback);
    return JSON.parse(row.value) as T;
  }

  private setValue(key: SettingsKey, value: unknown): void {
    this.database
      .prepare(`
        INSERT INTO settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `)
      .run(key, JSON.stringify(value));
  }
}
