import type { AIChatMessage, AIModelConfig, AIServiceConfig } from "@fast-social/contracts";
import type { FetchLike } from "../adapters/x/x-client.ts";
import { trace, withTrace } from '../observability/trace.ts';
import { readAIResponse } from './stream-reader.ts';

export interface CompletionInput {
  service: AIServiceConfig;
  model: AIModelConfig;
  messages: AIChatMessage[];
  maxOutputTokens?: number;
  timeoutMs?: number;
}

export class AIOutputTruncatedError extends Error {
  constructor() {
    super("AI 输出被截断（达到输出长度上限），未采用不完整结果");
  }
}

const MAX_TRUNCATION_RETRY_TOKENS = 32_768;

export class OpenAICompatibleClient {
  private readonly fetchImpl: FetchLike;

  constructor(fetchImpl: FetchLike = fetch) {
    this.fetchImpl = fetchImpl;
  }

  async complete(input: CompletionInput): Promise<string> {
    const deadline = Date.now() + (input.timeoutMs ?? 60_000);
    let current = input;
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await this.receive({ ...current, timeoutMs: Math.max(1, deadline - Date.now()) });
      if (result.truncated) {
        const reported = result.usage.completion_tokens ?? result.usage.output_tokens;
        const used = typeof reported === "number" && Number.isFinite(reported) && reported > 0 ? reported : 0;
        const previous = Math.max(current.maxOutputTokens ?? (input.service.apiFormat === "anthropic" ? 1024 : 4096), used);
        const next = Math.min(MAX_TRUNCATION_RETRY_TOKENS, Math.max(4096, Math.ceil(previous * 2)));
        // Retry the whole response once; never concatenate or accept partial structured output.
        // Share the original time budget so callers do not time out while a hidden retry continues.
        if (attempt === 0 && next > previous && Date.now() < deadline) {
          trace('ai.retry', 'AI 输出截断，增加输出预算后重试整次请求', { model: input.model.name, attempt: attempt + 1, previous, next });
          current = { ...input, maxOutputTokens: next };
          continue;
        }
        throw new AIOutputTruncatedError();
      }
      if (!result.content.trim()) throw new Error("AI 服务返回了空内容");
      trace('ai.complete', 'AI 返回完整内容', { serviceId: input.service.id, model: input.model.name, content: result.content, usage: result.usage });
      return result.content;
    }
    throw new AIOutputTruncatedError();
  }

  async stream(
    input: CompletionInput,
    onChunk: (chunk: string) => void | Promise<void>,
  ): Promise<void> {
    const result = await this.receive(input, onChunk);
    if (result.truncated) throw new AIOutputTruncatedError();
    if (!result.content.trim()) throw new Error("AI 服务返回了空内容");
  }

  private async receive(input: CompletionInput, onChunk?: (chunk: string) => void | Promise<void>) {
    const started = Date.now();
    const response = await this.request(input);
    trace('ai.stream.started', 'AI 响应连接已建立，开始接收内容', { serviceId: input.service.id, model: input.model.name, elapsedMs: Date.now() - started });
    let first = true;
    return readAIResponse(response, input.service.apiFormat ?? 'openai', async text => {
      if (first) {
        first = false;
        trace('ai.stream.first_text', 'AI 首段正文已收到', { serviceId: input.service.id, model: input.model.name, elapsedMs: Date.now() - started });
      }
      await onChunk?.(text);
    });
  }

  private async request(input: CompletionInput): Promise<Response> {
    if (!input.service.apiKey) throw new Error("AI 服务尚未配置 API Key");
    const apiFormat = input.service.apiFormat ?? "openai";
    const stream = true;
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "text/event-stream",
      authorization: `Bearer ${input.service.apiKey}`,
    };
    const body = apiFormat === "anthropic"
      ? anthropicRequestBody(input, stream)
      : apiFormat === "responses"
      ? responsesRequestBody(input, stream)
      : openAIRequestBody(input, stream);
    if (apiFormat === "anthropic") {
      headers["anthropic-version"] = "2023-06-01";
      headers["x-api-key"] = input.service.apiKey;
    }

    let response: Response;
    try {
      response = await withTrace({ serviceId: input.service.id, model: input.model.name, stream }, () => this.fetchImpl(input.service.endpoint, {
        signal: AbortSignal.timeout(input.timeoutMs ?? 60_000),
        method: "POST",
        headers,
        body: JSON.stringify(body),
      }));
    } catch (error) {
      throw connectionError(input.service.endpoint, error);
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`AI 服务请求失败（${response.status}）${detail ? `：${detail.slice(0, 300)}` : ""}`);
    }
    return response;
  }
}

function openAIRequestBody(input: CompletionInput, stream: boolean): Record<string, unknown> {
  return {
    model: input.model.name,
    messages: input.messages,
    ...(input.maxOutputTokens ? { max_tokens: input.maxOutputTokens } : {}),
    // The configured Kimi 2.6 endpoint rejects any temperature other than 1.
    temperature: input.model.name.toLowerCase() === "kimi-2.6" ? 1 : 0.2,
    stream,
    ...(input.model.thinking ? { thinking: input.model.thinking } : {}),
  };
}

function anthropicRequestBody(input: CompletionInput, stream: boolean): Record<string, unknown> {
  const system = input.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  return {
    model: input.model.name,
    messages: input.messages.filter((message) => message.role !== "system"),
    max_tokens: input.maxOutputTokens ?? 1024,
    temperature: 0.2,
    stream,
    ...(system ? { system } : {}),
  };
}

function responsesRequestBody(input: CompletionInput, stream: boolean): Record<string, unknown> {
  return {
    model: input.model.name,
    input: input.messages,
    ...(input.maxOutputTokens ? { max_output_tokens: input.maxOutputTokens } : {}),
    stream,
    // Conversation history is owned by this app; no upstream response IDs are needed.
    store: false,
  };
}

function connectionError(endpoint: string, error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error);
  let isHostLocal = false;
  try {
    const hostname = new URL(endpoint).hostname;
    isHostLocal = hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    // Endpoint validation reports malformed URLs before a request reaches this client.
  }
  const dockerHint = isHostLocal && detail.toLowerCase().includes("fetch failed")
    ? "；如果服务端运行在 Docker 中，请将地址里的 localhost/127.0.0.1 改为 host.docker.internal"
    : "";
  return new Error(`AI 服务连接失败：${detail}${dockerHint}`, { cause: error });
}
