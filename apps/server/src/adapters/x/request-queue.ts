import { AsyncLocalStorage } from 'node:async_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { trace, withTrace, errorDetails } from '../../observability/trace.ts';

export const X_REQUEST_INTERVAL_MS = 10_000;
const guards = new AsyncLocalStorage<() => void>();
const queuedRequests = new AsyncLocalStorage<boolean>();

/** Continuous tasks opt in; individual manual operations dispatch immediately. */
export function withQueuedXRequests<T>(work: () => T): T {
  return queuedRequests.run(true, work);
}

/** Recheck the originating workflow immediately before a queued request is sent. */
export function withXRequestGuard<T>(guard: () => void, work: () => T): T {
  const parent = guards.getStore();
  return guards.run(() => { parent?.(); guard(); }, work);
}

interface QueueOptions {
  intervalMs?: number;
  now?: () => number;
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

/** One instance per server, shared by all X clients, accounts and endpoints. */
export class XRequestQueue {
  private tail: Promise<void> = Promise.resolve();
  private readonly controller = new AbortController();
  private readonly interval: number;
  private readonly now: () => number;
  private readonly wait: NonNullable<QueueOptions['wait']>;
  private nextAt = 0;
  private pending = 0;

  constructor(options: QueueOptions = {}) {
    this.interval = options.intervalMs ?? X_REQUEST_INTERVAL_MS;
    if (!Number.isFinite(this.interval) || this.interval < 0) throw new Error('X 请求间隔无效');
    this.now = options.now ?? (() => performance.now());
    this.wait = options.wait ?? ((milliseconds, signal) => delay(milliseconds, undefined, { signal }));
  }

  request<T>(request: () => Promise<T>, beforeRequest: () => void = () => {}, details: Record<string, unknown> = {}): Promise<T> {
    if (queuedRequests.getStore()) return this.run(request, beforeRequest, details);
    return withTrace({ xRequestId: randomUUID(), requestMode: 'direct', ...details }, async () => {
      let started = false;
      try {
        this.ensureOpen();
        guards.getStore()?.();
        // Direct requests retain the same credential, cancellation and daily quota checks.
        beforeRequest();
        started = true;
        return await request();
      } catch (error) {
        trace(started ? 'x.failed' : 'x.blocked', started ? 'X 请求处理失败' : 'X 请求未发送', { error: errorDetails(error) });
        throw error;
      }
    });
  }

  run<T>(request: () => Promise<T>, beforeRequest: () => void = () => {}, details: Record<string, unknown> = {}): Promise<T> {
    return withTrace({ xRequestId: randomUUID(), requestMode: 'queued', ...details }, () => {
      const guard = guards.getStore();
      const queuedAt = this.now();
      let waited = this.pending > 0;
      if (waited) trace('x.queued', '等待前序 X 请求完成', { requestsAhead: this.pending });
      this.pending++;
      const current = this.tail.then(async () => {
        let started = false;
        try {
          this.ensureOpen();
          guard?.();
          while (this.nextAt > this.now()) {
            waited = true;
            trace('x.wait', '等待 X 请求间隔', { waitMs: Math.ceil(this.nextAt - this.now()), intervalMs: this.interval });
            try { await this.wait(this.nextAt - this.now(), this.controller.signal); }
            catch (error) { this.ensureOpen(); throw error; }
            this.ensureOpen();
          }
          guard?.();
          // Credentials and quota are checked after waiting. Rejected queued work
          // does not spend quota or reserve another cooldown period.
          beforeRequest();
          started = true;
          if (waited) trace('x.start', 'X 等待结束，开始发送', { queuedMs: Math.round(this.now() - queuedAt) });
          try { return await request(); }
          finally { this.nextAt = this.now() + this.interval; }
        } catch (error) {
          trace(started ? 'x.failed' : 'x.blocked', started ? 'X 请求处理失败' : 'X 请求未发送', { error: errorDetails(error) });
          throw error;
        } finally {
          this.pending--;
        }
      });
      // Failure releases the queue while retaining the interval; it never retries.
      this.tail = current.then(() => {}, () => {});
      return current;
    });
  }

  stop(): void { this.controller.abort(); }
  private ensureOpen(): void {
    if (this.controller.signal.aborted) throw new Error('服务正在停止，排队中的 X 请求未发送');
  }
}
