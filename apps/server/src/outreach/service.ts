import { randomUUID } from 'node:crypto';
import { ValidationError } from '../http/validation.ts';
import { OutreachRepository } from './repository.ts';
import { OutreachRunner, validateConfig } from './runner.ts';
import type { OutreachAdapter, OutreachClassifier } from './types.ts';

/** Account-scoped workers share one persisted, round-robin request dispatcher. */
export class OutreachService {
  private readonly repository: OutreachRepository;
  private readonly social: OutreachAdapter;
  private readonly classifier: OutreachClassifier;
  private readonly now: () => number;
  private readonly workers = new Map<string, OutreachRunner>();
  private active: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private stopped = false;
  constructor(repository: OutreachRepository, social: OutreachAdapter, classifier: OutreachClassifier, now = Date.now) {
    this.repository = repository; this.social = social; this.classifier = classifier; this.now = now;
    for (const config of repository.accounts()) this.worker(config.id);
  }
  list() { return this.repository.listView(this.now()); }
  has(id: string) { return this.repository.account(id) !== null; }
  view(id: string) { return this.worker(id).view(); }
  create(input: unknown) {
    const config = validateConfig(input);
    let actorId: string;
    try { actorId = this.social.identity(config.cookieId).actorId; }
    catch (error) { throw new ValidationError(error instanceof Error ? error.message : 'Cookie 不可用'); }
    if (this.repository.accounts().some(account => account.actorId === actorId)) throw new ValidationError('这个 X 账号已添加，请编辑已有互关账户');
    const id = randomUUID();
    this.repository.saveConfig({ ...config, id, actorId });
    return this.worker(id).view();
  }
  update(id: string, input: unknown) { return this.worker(id).saveConfig(input); }
  toggle(id: string, enabled: unknown) {
    if (typeof enabled !== 'boolean') throw new ValidationError('enabled 必须为布尔值');
    const { actorId: _actor, id: _id, ...input } = this.repository.scope(id).config();
    return this.update(id, { ...input, enabled });
  }
  remove(id: string) {
    const worker = this.worker(id);
    worker.stopChecks();
    void worker.stop();
    this.repository.removeAccount(id);
    this.workers.delete(id);
  }
  startChecks(id: string) { return this.worker(id).startChecks(); }
  stopChecks(id: string) { return this.worker(id).stopChecks(); }
  resume(id: string) { return this.worker(id).resume(); }
  private worker(id: string) {
    let worker = this.workers.get(id);
    if (!worker) {
      worker = new OutreachRunner(this.repository.scope(id), this.social, this.classifier, this.now, config => this.repository.reserveDispatch(config, this.now()));
      this.workers.set(id, worker);
    }
    return worker;
  }
  start() {
    if (this.timer) return;
    this.stopped = false;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), 5000);
    this.timer.unref();
  }
  async stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await Promise.all([this.active, ...[...this.workers.values()].map(worker => worker.stop())]);
  }
  tick(): Promise<void> {
    if (this.stopped || this.active) return this.active ?? Promise.resolve();
    this.active = this.dispatch().finally(() => { this.active = null; });
    return this.active;
  }
  private async dispatch() {
    const state = this.repository.dispatcher();
    if (state.nextRequestAt && Date.parse(state.nextRequestAt) > this.now()) return;
    const accounts = this.repository.accounts();
    const start = (accounts.findIndex(account => account.id === state.lastAccountId) + 1) % Math.max(1, accounts.length);
    for (let offset = 0; offset < accounts.length; offset += 1) {
      if (this.stopped) return;
      const account = accounts[(start + offset) % accounts.length]!;
      if (!this.has(account.id)) continue;
      await this.worker(account.id).tick();
      const latest = this.repository.dispatcher();
      // A slow AI request may outlast the cooldown; still allow just one dispatch per tick.
      if (latest.lastAccountId !== state.lastAccountId || latest.nextRequestAt !== state.nextRequestAt) return;
    }
  }
}
