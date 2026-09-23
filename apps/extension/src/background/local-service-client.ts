import type { ApiResponse } from "@fast-social/contracts";

const BASE_URL = "http://127.0.0.1:5127";
export const DEFAULT_LOCAL_SERVICE_TIMEOUT_MS = 3_000;
export const AI_LOCAL_SERVICE_TIMEOUT_MS = 70_000;
export const X_TEST_LOCAL_SERVICE_TIMEOUT_MS = 40_000;
export const MONITOR_TEST_LOCAL_SERVICE_TIMEOUT_MS = 600_000;
export const TELEGRAM_TEST_LOCAL_SERVICE_TIMEOUT_MS = 15_000;

export function resolveLocalServiceTimeout(
  path: string,
  requestedTimeoutMs?: number,
): number {
  if (requestedTimeoutMs !== undefined) return requestedTimeoutMs;
  if (path === "/api/ai/chat" || path === "/api/test/ai") {
    return AI_LOCAL_SERVICE_TIMEOUT_MS;
  }
  if (path === "/api/test/x") return X_TEST_LOCAL_SERVICE_TIMEOUT_MS;
  if (path === "/api/test/telegram") return TELEGRAM_TEST_LOCAL_SERVICE_TIMEOUT_MS;
  if (/^\/api\/monitors\/[^/]+\/(run|profile)$/.test(path)) {
    return MONITOR_TEST_LOCAL_SERVICE_TIMEOUT_MS;
  }
  return DEFAULT_LOCAL_SERVICE_TIMEOUT_MS;
}

export class LocalServiceError extends Error {
  readonly code: string;

  constructor(message: string, code = "LOCAL_SERVICE_ERROR") {
    super(message);
    this.name = "LocalServiceError";
    this.code = code;
  }
}

export class LocalServiceClient {
  private readonly fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch = fetch) {
    this.fetchImpl = fetchImpl.bind(globalThis);
  }

  async request<T>(
    path: string,
    options: { method?: string; body?: unknown; timeoutMs?: number } = {},
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      resolveLocalServiceTimeout(path, options.timeoutMs),
    );
    try {
      const response = await this.fetchImpl(`${BASE_URL}${path}`, {
        method: options.method ?? "GET",
        headers: options.body === undefined ? undefined : { "content-type": "application/json" },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
      let payload: ApiResponse<T> | T;
      try {
        payload = (await response.json()) as ApiResponse<T>;
      } catch {
        throw new LocalServiceError("本地服务返回了无效数据");
      }
      if (typeof payload !== "object" || payload === null) {
        throw new LocalServiceError("本地服务返回了无效数据");
      }
      const envelope = payload as ApiResponse<T>;
      if (!response.ok || ("ok" in payload && envelope.ok === false)) {
        throw new LocalServiceError(
          envelope.ok === false ? envelope.error.message : `本地服务请求失败（${response.status}）`,
          envelope.ok === false ? envelope.error.code : "LOCAL_SERVICE_ERROR",
        );
      }
      if ("data" in payload) {
        return (payload as { data: T }).data;
      }
      return payload as T;
    } catch (error) {
      if (error instanceof LocalServiceError) throw error;
      throw new LocalServiceError(
        error instanceof DOMException && error.name === "AbortError"
          ? "连接本地服务超时"
          : "本地服务未启动或无法连接",
        "LOCAL_SERVICE_UNAVAILABLE",
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async streamChat(
    body: unknown,
    onChunk: (chunk: string) => void,
  ): Promise<void> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${BASE_URL}/api/ai/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...(body as object), stream: true }),
        signal: AbortSignal.timeout(70_000),
      });
    } catch {
      throw new LocalServiceError("本地服务未启动或无法连接", "LOCAL_SERVICE_UNAVAILABLE");
    }
    if (!response.ok || !response.body) throw new LocalServiceError("AI 流式请求失败");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = done ? "" : (lines.pop() ?? "");
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as { chunk?: string; error?: string };
        if (event.error) throw new LocalServiceError(event.error);
        if (event.chunk) onChunk(event.chunk);
      }
      if (done) break;
    }
  }
}

export const localServiceClient = new LocalServiceClient();
