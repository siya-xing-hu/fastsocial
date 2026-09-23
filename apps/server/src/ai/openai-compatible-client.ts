import type { AIChatMessage, AIModelConfig, AIServiceConfig } from "@fast-social/contracts";
import type { FetchLike } from "../adapters/x/x-client.ts";

export interface CompletionInput {
  service: AIServiceConfig;
  model: AIModelConfig;
  messages: AIChatMessage[];
  maxOutputTokens?: number;
  timeoutMs?: number;
}

export class OpenAICompatibleClient {
  private readonly fetchImpl: FetchLike;

  constructor(fetchImpl: FetchLike = fetch) {
    this.fetchImpl = fetchImpl;
  }

  async complete(input: CompletionInput): Promise<string> {
    const response = await this.request(input, false);
    const payload = (await response.json()) as {
      choices?: Array<{ finish_reason?: string; message?: { content?: string } }>;
      content?: Array<{ text?: string }>;
      stop_reason?: string;
    };
    if (payload.stop_reason === 'max_tokens' || payload.choices?.[0]?.finish_reason === 'length') {
      throw new Error('AI 输出被截断，监听偏移量保持不变');
    }
    const content = input.service.apiFormat === "anthropic"
      ? payload.content
        ?.map((block) => block.text)
        .filter((text): text is string => typeof text === "string")
        .join("")
      : payload.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content) {
      throw new Error("AI 服务返回了空内容");
    }
    return content;
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
          choices?: Array<{ delta?: { content?: string } }>;
          delta?: { text?: string };
          error?: { message?: string };
        };
        try {
          payload = JSON.parse(data) as typeof payload;
        } catch {
          // Ignore keepalive and provider-specific lines.
          continue;
        }
        if (payload.error) throw new Error(payload.error.message || "AI 流返回错误");
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
      response = await this.fetchImpl(input.service.endpoint, {
        signal: AbortSignal.timeout(input.timeoutMs ?? 60_000),
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
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
