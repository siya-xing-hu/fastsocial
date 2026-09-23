import { createHash } from 'node:crypto';
import type { AIChatMessage, AIModelConfig, AIServiceConfig } from "@fast-social/contracts";
import type { SettingsRepository } from "../repositories/settings-repository.ts";
import { OpenAICompatibleClient } from "./openai-compatible-client.ts";

export class AIGateway {
  private readonly settings: SettingsRepository;
  private readonly client: OpenAICompatibleClient;

  constructor(settings: SettingsRepository, client = new OpenAICompatibleClient()) {
    this.settings = settings;
    this.client = client;
  }

  complete(provider: string | undefined, messages: AIChatMessage[], maxOutputTokens?: number): Promise<string> {
    const resolved = this.resolve(provider);
    return this.client.complete({ ...resolved, messages, maxOutputTokens, ...(maxOutputTokens ? { timeoutMs: 180_000 } : {}) });
  }

  fingerprint(): string {
    const resolved = this.resolve();
    return createHash('sha256').update(JSON.stringify(resolved)).digest('hex');
  }

  stream(
    provider: string | undefined,
    messages: AIChatMessage[],
    onChunk: (chunk: string) => void | Promise<void>,
  ): Promise<void> {
    const resolved = this.resolve(provider);
    return this.client.stream({ ...resolved, messages }, onChunk);
  }

  options(): Array<{ value: string; label: string }> {
    const ai = this.settings.getAI();
    return ai.services.flatMap((service) =>
      service.enabled && Boolean(service.apiKey)
        ? service.models.map((model) => ({
            value: `${service.id}:${model.name}`,
            label: `${service.name} / ${model.name}`,
          }))
        : [],
    );
  }

  private resolve(provider?: string): { service: AIServiceConfig; model: AIModelConfig } {
    const ai = this.settings.getAI();
    const selected = provider || ai.defaultProvider;
    const separator = selected.indexOf(":");
    const serviceId = separator >= 0 ? selected.slice(0, separator) : "";
    const modelName = separator >= 0 ? selected.slice(separator + 1) : "";
    const service = ai.services.find((item) => item.id === serviceId && item.enabled);
    const model = service?.models.find((item) => item.name === modelName);
    if (!service || !model) throw new Error("请选择可用的 AI 服务和模型");
    return { service, model };
  }
}
