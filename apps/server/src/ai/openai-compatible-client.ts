import type { AIChatMessage, AIModelConfig, AIServiceConfig } from "@fast-social/contracts";
import type { FetchLike } from "../adapters/x/x-client.ts";
import { trace, withTrace } from '../observability/trace.ts';

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
      const response = await this.request({ ...current, timeoutMs: Math.max(1, deadline - Date.now()) }, false);
      const payload = (await response.json()) as {
        choices?: Array<{ finish_reason?: string; message?: { content?: string } }>;
        content?: Array<{ text?: string }>;
        stop_reason?: string;
        usage?: { completion_tokens?: number; output_tokens?: number };
      };
      if (payload.stop_reason === "max_tokens" || payload.choices?.[0]?.finish_reason === "length") {
        const reported = payload.usage?.completion_tokens ?? payload.usage?.output_tokens;
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
      const content = input.service.apiFormat === "anthropic"
        ? payload.content
          ?.map((block) => block.text)
          .filter((text): text is string => typeof text === "string")
          .join("")
        : payload.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content) throw new Error("AI 服务返回了空内容");
      trace('ai.complete', 'AI 返回完整内容', { serviceId: input.service.id, model: input.model.name, content, usage: payload.usage });
      return content;
    }
    throw new AIOutputTruncatedError();
  }

  async stream(
    input: CompletionInput,
    onChunk: (chunk: string) => void | Promise<void>,
  ): Promise<void> {
    const response = await this.request(input, true);
    if (!response.body) throw new Error("AI 服务没有返回数据流");
    const apiFormat = input.service.apiFormat ?? "openai";
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = done ? "" : (lines.pop() ?? "");
      for (const line of lines) {
        const data = line.trim().replace(/^data:\s*/, "");
        if (!data || data === "[DONE]") continue;
        let payload: {
          type?: string;
          choices?: Array<{ finish_reason?: string; delta?: { content?: string } }>;
          delta?: { text?: string; stop_reason?: string };
          error?: { message?: string };
        };
        try {
          payload = JSON.parse(data) as typeof payload;
        } catch {
          // Ignore keepalive and provider-specific lines.
          continue;
        }
        if (payload.error) throw new Error(payload.error.message || "AI 流返回错误");
        if (payload.choices?.[0]?.finish_reason === "length" || payload.delta?.stop_reason === "max_tokens") {
          await reader.cancel();
          throw new AIOutputTruncatedError();
        }
        const chunk = apiFormat === "anthropic"
          ? payload.type === "content_block_delta" ? payload.delta?.text : undefined
          : payload.choices?.[0]?.delta?.content;
        if (chunk) await onChunk(chunk);
      }
      if (done) break;
    }
  }

  private async request(input: CompletionInput, stream: boolean): Promise<Response> {
    if (!input.service.apiKey) throw new Error("AI 服务尚未配置 API Key");
    const apiFormat = input.service.apiFormat ?? "openai";
    const headers: Record<string, string> = {
      "content-type": "application/json",
      authorization: `Bearer ${input.service.apiKey}`,
    };
    const body = apiFormat === "anthropic"
      ? anthropicRequestBody(input, stream)
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
