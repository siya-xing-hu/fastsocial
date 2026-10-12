import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

type Fields = Record<string, unknown>;
export interface TraceEntry {
  time: string;
  event: string;
  message: string;
  context: Fields;
  data: Fields;
}
export type TraceSink = (entry: TraceEntry) => void;
const scope = new AsyncLocalStorage<{ logger: ExecutionLogger; context: Fields }>();

/** Full local diagnostics are intentional: the user requested replayable credentials and payloads. */
export function formatTrace(entry: TraceEntry): string {
  if (entry.event !== 'http.request') return `${JSON.stringify(entry)}\n`;
  const { curl, url, method } = entry.data;
  // The completed exchange contains all five HTTP fields on one JSON line.
  // At send time only print its identity and the exact copyable command.
  return `${JSON.stringify({ ...entry, data: { url, method } })}\n${typeof curl === 'string' ? `${curl}\n` : ''}`;
}

function requestLabel(system: 'X' | 'AI' | 'Telegram', url: string): string {
  if (system === 'AI') return String(scope.getStore()?.context.aiOperation ?? 'AI 请求');
  if (system === 'Telegram') return '发送通知';
  const operation = new URL(url).pathname.split('/').at(-1) ?? '';
  return ({ HomeTimeline: '获取账号首页', UserByScreenName: '获取用户 Profile', UserByRestId: '获取用户 Profile',
    UserTweets: '获取用户 Post', UserTweetsAndReplies: '获取用户 Post 与回复', CreateTweet: '回复 Post',
    'create.json': '关注作者', 'destroy.json': '取消关注', 'show.json': '查询关注关系',
  } as Record<string, string>)[operation] ?? `X ${operation}`;
}

export function trace(event: string, message: string, data: Fields = {}): void {
  const current = scope.getStore();
  current?.logger.emit(event, message, data);
}

export function withTrace<T>(fields: Fields, work: () => T): T {
  const current = scope.getStore();
  return current ? current.logger.run(fields, work) : work();
}

export function setTraceFields(fields: Fields): void {
  const current = scope.getStore();
  if (current) Object.assign(current.context, fields);
}

export function errorDetails(error: unknown): Fields {
  if (!(error instanceof Error)) return { message: String(error) };
  return { name: error.name, message: error.message, stack: error.stack,
    ...(error.cause ? { cause: errorDetails(error.cause) } : {}) };
}

const quote = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`;
function headerValues(headers: Headers): Record<string, string> {
  const values: Record<string, string> = {};
  headers.forEach((value, name) => { values[name] = value; });
  return values;
}
export function requestCurl(url: string, method: string, headers: Headers, body?: string, redirect?: RequestRedirect): string {
  const args = ['curl', '-q', '--silent', '--show-error', '--include', '--globoff', '--compressed'];
  if (!redirect || redirect === 'follow') args.push('--location');
  args.push('--request', quote(method), '--url', quote(url));
  headers.forEach((value, name) => args.push('--header', quote(`${name}: ${value}`)));
  if (body !== undefined) args.push('--data-raw', quote(body));
  return args.join(' ');
}

export class ExecutionLogger {
  private readonly sink?: TraceSink;
  constructor(sink?: TraceSink) { this.sink = sink; }
  run<T>(fields: Fields, work: () => T): T {
    const parent = scope.getStore()?.context;
    return scope.run({ logger: this, context: { traceId: randomUUID(), ...parent, ...fields } }, work);
  }
  emit(event: string, message: string, data: Fields = {}): void {
    // Observability must not change action success, retry decisions, or quota consumption.
    try { this.sink?.({ time: new Date().toISOString(), event, message, context: { ...scope.getStore()?.context }, data }); }
    catch { /* An unavailable log sink cannot retry or fail an external action. */ }
  }
  fetch(system: 'X' | 'AI' | 'Telegram', fetchImpl: typeof fetch): typeof fetch {
    if (!this.sink) return fetchImpl;
    return (input, init) => this.run({ system, requestId: randomUUID() }, async () => {
      const start = performance.now();
      const url = input instanceof Request ? input.url : String(input);
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      const label = requestLabel(system, url);
      let body: string | undefined;
      let metadata: Fields = { status: null, responseHeaders: null };
      const details = (responseBody: string | null) => ({ url, method, requestHeaders: headerValues(headers), requestBody: body ?? null,
        ...metadata, responseBody, elapsedMs: Math.round(performance.now() - start) });
      try {
        if (typeof init?.body === 'string') body = init.body;
        else if (init?.body instanceof URLSearchParams) body = init.body.toString();
        else if (input instanceof Request && init?.body === undefined && input.body) body = await input.clone().text();
        const redirect = init?.redirect ?? (input instanceof Request ? input.redirect : undefined);
        this.emit('http.request', `${label}：curl`, { url, method, headers: headerValues(headers), body,
          curl: requestCurl(url, method, headers, body, redirect) });
        // Log the exact request at the actual send point, after X queue guards and quota checks.
        const response = await fetchImpl(input, init);
        metadata = { responseUrl: response.url || url, status: response.status, statusText: response.statusText,
          responseHeaders: headerValues(response.headers) };
        if (response.headers.get('content-type')?.includes('text/event-stream') && response.body) {
          const reader = response.body.getReader(), decoder = new TextDecoder();
          const current = scope.getStore()!;
          const chunks: string[] = [];
          let logged = false;
          const finish = (event: string, message: string, extra: Fields = {}) => {
            if (logged) return;
            logged = true;
            const responseBody = chunks.join(''); chunks.length = 0;
            scope.run(current, () => this.emit(event, message, { ...details(responseBody), streamed: true, ...extra }));
          };
          const stream = new ReadableStream<Uint8Array>({
            async pull(controller) {
              try {
                const { value, done } = await reader.read();
                const text = decoder.decode(value, { stream: !done });
                if (text && !logged) chunks.push(text);
                if (done) {
                  finish('http.response', `${label}：请求与响应`);
                  controller.close();
                } else controller.enqueue(value);
              } catch (error) {
                finish('http.error', `${label}：响应读取失败`, { error: errorDetails(error) });
                controller.error(error);
              }
            },
            async cancel(reason) {
              finish('http.cancelled', `${label}：响应读取已停止`, { reason: String(reason ?? '') });
              await reader.cancel(reason);
            },
          });
          return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
        }
        const raw = await response.text();
        this.emit('http.response', `${label}：请求与响应`, details(raw));
        return new Response([101, 204, 205, 304].includes(response.status) || method === 'HEAD' ? null : raw,
          { status: response.status, statusText: response.statusText, headers: response.headers });
      } catch (error) {
        this.emit('http.error', `${label}：请求失败`, { ...details(null), error: errorDetails(error) });
        throw error;
      }
    });
  }
}
