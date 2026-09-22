import type { AIChatMessage, AIModelConfig, AIServiceConfig } from "@fast-social/contracts";
import type { FetchLike } from "../adapters/x/x-client.ts";

export interface CompletionInput {
  service: AIServiceConfig;
  model: AIModelConfig;
  messages: AIChatMessage[];
}

export class OpenAICompatibleClient {
  private readonly fetchImpl: FetchLike;

  constructor(fetchImpl: FetchLike = fetch) {
    this.fetchImpl = fetchImpl;
  }

  async complete(input: CompletionInput): Promise<string> {
    const response = await this.request(input, false);
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
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
          choices?: Array<{ delta?: { content?: string } }>;
          error?: { message?: string };
        };
        try {
          payload = JSON.parse(data) as typeof payload;
        } catch {
          // Ignore keepalive and provider-specific lines.
          continue;
        }
        if (payload.error) throw new Error(payload.error.message || "AI 流返回错误");
        const chunk = payload.choices?.[0]?.delta?.content;
        if (chunk) await onChunk(chunk);
      }
      if (done) break;
    }
  }

  private async request(input: CompletionInput, stream: boolean): Promise<Response> {
    if (!input.service.apiKey) throw new Error("AI 服务尚未配置 API Key");
    const response = await this.fetchImpl(input.service.endpoint, {
      signal: AbortSignal.timeout(60_000),
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.service.apiKey}`,
      },
      body: JSON.stringify({
        model: input.model.name,
        messages: input.messages,
        temperature: 0.2,
        stream,
        ...(input.model.thinking ? { thinking: input.model.thinking } : {}),
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`AI 服务请求失败（${response.status}）${detail ? `：${detail.slice(0, 300)}` : ""}`);
    }
    return response;
  }
}
