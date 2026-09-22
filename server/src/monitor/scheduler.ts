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
    await Promise.all(due.map((monitor) => this.runOne(monitor.id)));
  }

  private async runOne(id: string): Promise<void> {
    this.running.add(id);
    try {
      await this.runner.run(id);
    } catch {
      // The runner stores the actionable error on the monitor itself.
    } finally {
      this.running.delete(id);
    }
  }
}
