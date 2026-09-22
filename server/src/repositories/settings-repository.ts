import type { DatabaseSync } from "node:sqlite";
import type {
  AIServiceConfig,
  AISettings,
  InteractionPrompt,
  ServerSettings,
  ServerSettingsPatch,
  TelegramSettings,
  XSettings,
} from "@fast-social/contracts";

const DEFAULT_AI: AISettings = { services: [], defaultProvider: "" };
const DEFAULT_X: XSettings = {};
const DEFAULT_TELEGRAM: TelegramSettings = { chatId: "" };

type SettingsKey = "ai" | "interaction_prompts" | "x" | "telegram";

export class SettingsRepository {
  private readonly database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.database = database;
  }

  getPublic(): ServerSettings {
    const ai = this.getValue<AISettings>("ai", DEFAULT_AI);
    const x = this.getValue<XSettings>("x", DEFAULT_X);
    const telegram = this.getValue<TelegramSettings>("telegram", DEFAULT_TELEGRAM);
    const interactionPrompts = this.getValue<InteractionPrompt[]>(
      "interaction_prompts",
      [],
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
      x: { cookieConfigured: Boolean(x.cookie) },
      telegram: {
        chatId: telegram.chatId,
        botTokenConfigured: Boolean(telegram.botToken),
      },
    };
  }

  getAI(): AISettings {
    return this.getValue<AISettings>("ai", DEFAULT_AI);
  }

  getX(): XSettings {
    return this.getValue<XSettings>("x", DEFAULT_X);
  }

  getTelegram(): TelegramSettings {
    return this.getValue<TelegramSettings>("telegram", DEFAULT_TELEGRAM);
  }

  getInteractionPrompts(): InteractionPrompt[] {
    return this.getValue<InteractionPrompt[]>("interaction_prompts", []);
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
      this.setValue("x", { ...this.getX(), ...patch.x });
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
