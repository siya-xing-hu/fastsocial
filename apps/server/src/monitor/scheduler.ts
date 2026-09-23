import type { MonitorRepository } from "../repositories/monitor-repository.ts";
import type { MonitorRunner } from "./monitor-runner.ts";

export class MonitorScheduler {
  private readonly monitors: MonitorRepository;
  private readonly runner: MonitorRunner;
  private readonly running = new Set<string>();
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(monitors: MonitorRepository, runner: MonitorRunner) {
    this.monitors = monitors;
    this.runner = runner;
  }

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), 60_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(now = Date.now()): Promise<void> {
    const due = this.monitors.list().filter((monitor) => {
      if (!monitor.enabled || this.running.has(monitor.id)) return false;
      if (!monitor.lastCheckedAt) return true;
      return now - Date.parse(monitor.lastCheckedAt) >= monitor.intervalMinutes * 60_000;
    });
    const groups = new Map<string, string[]>();
    for (const monitor of due) {
      const key = monitor.username.toLowerCase();
      groups.set(key, [...(groups.get(key) ?? []), monitor.id]);
    }
    await Promise.all([...groups.values()].map(ids => this.runGroup(ids)));
  }

  private async runGroup(ids: string[]): Promise<void> {
    for (const id of ids) this.running.add(id);
    try { await this.runner.runMany(ids); }
    catch { /* The runner stores the actionable error. */ }
    finally { for (const id of ids) this.running.delete(id); }
  }
}
