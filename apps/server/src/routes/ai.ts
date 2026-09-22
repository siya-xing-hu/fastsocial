import type { FastifyInstance } from "fastify";
import type { AIChatMessage, ApiSuccess, InteractionPrompt } from "@fast-social/contracts";
import type { AIGateway } from "../ai/ai-gateway.ts";
import { ValidationError } from "../http/validation.ts";
import type { SettingsRepository } from "../repositories/settings-repository.ts";

export function registerAIRoutes(
  app: FastifyInstance,
  gateway: AIGateway,
  settings: SettingsRepository,
): void {
  app.get("/api/ai/options", async () => ({
    ok: true,
    data: {
      options: gateway.options(),
      defaultProvider: settings.getAI().defaultProvider,
    },
  }));

  app.get("/api/prompts", async (): Promise<ApiSuccess<InteractionPrompt[]>> => ({
    ok: true,
    data: settings.getInteractionPrompts().filter((prompt) => prompt.enabled),
  }));

  app.post("/api/ai/chat", async (request, reply) => {
    const input = validateChatRequest(request.body);
    if (!input.stream) {
      return { ok: true, data: await gateway.complete(input.provider, input.messages) };
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache",
    });
    try {
      await gateway.stream(input.provider, input.messages, (chunk) => {
        reply.raw.write(`${JSON.stringify({ chunk })}\n`);
      });
      reply.raw.write(`${JSON.stringify({ done: true })}\n`);
    } catch (error) {
      reply.raw.write(`${JSON.stringify({ error: errorMessage(error) })}\n`);
    } finally {
      reply.raw.end();
    }
  });
}

function validateChatRequest(value: unknown): {
  provider?: string;
  messages: AIChatMessage[];
  stream: boolean;
} {
  if (!isObject(value) || !Array.isArray(value.messages) || value.messages.length === 0) {
    throw new ValidationError("AI 消息不能为空");
  }
  const messages = value.messages.map((message) => {
    if (
      !isObject(message) ||
      !["user", "assistant", "system"].includes(String(message.role)) ||
      typeof message.content !== "string"
    ) {
      throw new ValidationError("AI 消息格式无效");
    }
    return { role: message.role, content: message.content } as AIChatMessage;
  });
  return {
    ...(typeof value.provider === "string" ? { provider: value.provider } : {}),
    messages,
    stream: value.stream === true,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
