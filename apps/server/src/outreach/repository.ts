import type { DatabaseSync } from 'node:sqlite';
import type { OutreachAccountsView, OutreachConfig, OutreachRecord, OutreachState, OutreachView } from '@fast-social/contracts';

export const DEFAULT_OUTREACH_CONFIG: OutreachConfig = {
  id: '', name: '', enabled: false, cookieId: '', actorId: '', prompt: '作者明确希望互相关注、扩列或结识朋友并互关时命中；排除广告、付费要求、否定表达和仅引用他人邀请的帖子。',
  intervalMinutes: 60, dailyLimit: 10, requestGapSeconds: 60, replyText: '已关注，互相联系～',
};
export class OutreachRepository {
  private readonly db: DatabaseSync;
  readonly accountId: string | undefined;
  private readonly actorId: string | undefined;
  constructor(db: DatabaseSync, accountId?: string) {
    this.db = db; this.accountId = accountId;
    if (accountId) this.actorId = this.account(accountId)?.actorId;
    else this.migrate();
  }
  private read<T>(key: string, fallback: T): T {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row ? JSON.parse(row.value) as T : structuredClone(fallback);
  }
  private write(key: string, value: unknown): void {
    this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
  }
  accounts(): OutreachConfig[] {
    return (this.db.prepare('SELECT value FROM outreach_accounts ORDER BY rowid').all() as { value: string }[]).map(row => JSON.parse(row.value));
  }
  account(id: string): OutreachConfig | null {
    const row = this.db.prepare('SELECT value FROM outreach_accounts WHERE id = ?').get(id) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : null;
  }
  scope(id: string): OutreachRepository {
    if (!this.account(id)) throw new Error('互关账户不存在');
    return new OutreachRepository(this.db, id);
  }
  config(): OutreachConfig {
    const config = this.accountId ? this.account(this.accountId) : null;
    if (!config) throw new Error('互关账户不存在');
    return config;
  }
  exists(): boolean { return !!this.accountId && this.account(this.accountId) !== null; }
  saveConfig(config: OutreachConfig): void {
    this.db.prepare('INSERT INTO outreach_accounts (id, actor_id, value) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET actor_id = excluded.actor_id, value = excluded.value').run(config.id, config.actorId, JSON.stringify(config));
  }
  removeAccount(id: string): void {
    const config = this.account(id);
    if (!config) return;
    for (const row of this.all().filter(row => row.actorId === config.actorId && ['pending_follow', 'pending_reply'].includes(row.stage))) {
      this.patch(row.id, { stage: 'skipped', actionError: '互关账户已移除，停止待执行的互动' });
    }
    this.db.prepare('DELETE FROM outreach_accounts WHERE id = ?').run(id);
  }
  state(): OutreachState { return this.read(`outreach_account_state:${this.actorId}`, { nextRequestAt: null, lastFetchedAt: null, pauseReason: null, checkJob: null }); }
  patchState(patch: Partial<OutreachState>): void {
    if (!this.actorId) throw new Error('缺少互关账户身份');
    this.write(`outreach_account_state:${this.actorId}`, { ...this.state(), ...patch });
  }
  dispatcher(): { nextRequestAt: string | null; lastAccountId: string | null } {
    return this.read('outreach_dispatcher', { nextRequestAt: null, lastAccountId: null });
  }
  reserveDispatch(config: OutreachConfig, now: number): void {
    this.write('outreach_dispatcher', { nextRequestAt: new Date(now + config.requestGapSeconds * 1000).toISOString(), lastAccountId: config.id });
  }
  all(): OutreachRecord[] {
    return (this.db.prepare('SELECT value FROM outreach_records ORDER BY rowid DESC').all() as { value: string }[]).map(row => JSON.parse(row.value));
  }
  get(id: string): OutreachRecord | null {
    const row = this.db.prepare('SELECT value FROM outreach_records WHERE id = ?').get(id) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : null;
  }
  add(record: OutreachRecord): void {
    this.db.prepare('INSERT OR IGNORE INTO outreach_records (id, value) VALUES (?, ?)').run(record.id, JSON.stringify(record));
  }
  patch(id: string, patch: Partial<OutreachRecord>): void {
    const record = this.get(id);
    if (record) this.db.prepare('UPDATE outreach_records SET value = ? WHERE id = ?').run(JSON.stringify({ ...record, ...patch, id: record.id }), id);
  }
  seen(actorId: string, postId: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM outreach_seen_posts WHERE id = ?').get(`${actorId}:${postId}`));
  }
  recentSeen(actorId: string): string[] {
    return (this.db.prepare('SELECT id FROM outreach_seen_posts WHERE id LIKE ? ORDER BY seen_at DESC, rowid DESC LIMIT 20').all(`${actorId}:%`) as { id: string }[]).map(row => row.id.slice(actorId.length + 1));
  }
  markSeen(actorId: string, postIds: string[], now: number): void {
    const statement = this.db.prepare('INSERT OR IGNORE INTO outreach_seen_posts (id, seen_at) VALUES (?, ?)');
    for (const id of postIds) statement.run(`${actorId}:${id}`, new Date(now).toISOString());
    this.db.prepare('DELETE FROM outreach_seen_posts WHERE seen_at < ?').run(new Date(now - 30 * 86400000).toISOString());
  }
  attempts(actorId: string, now: number): number {
    const day = new Date(now).toISOString().slice(0, 10);
    return this.all().filter(row => row.actorId === actorId && row.followAttemptAt?.startsWith(day)).length;
  }
  view(now: number): OutreachView {
    const config = this.config();
    return { config, state: this.displayState(), records: this.all().filter(row => row.actorId === config.actorId), todayFollowAttempts: this.attempts(config.actorId, now) };
  }
  private displayState(): OutreachState {
    const state = this.state();
    const next = Math.max(Date.parse(state.nextRequestAt ?? '') || 0, Date.parse(this.dispatcher().nextRequestAt ?? '') || 0);
    return { ...state, nextRequestAt: next ? new Date(next).toISOString() : null };
  }
  listView(now: number): OutreachAccountsView {
    const { id: _id, actorId: _actorId, ...defaults } = DEFAULT_OUTREACH_CONFIG;
    return { defaults, accounts: this.accounts().map(config => {
      const records = this.all().filter(row => row.actorId === config.actorId);
      return { config, state: this.scope(config.id).displayState(), recordCount: records.length, mutualCount: records.filter(row => row.following && row.followedBy).length, todayFollowAttempts: this.attempts(config.actorId, now) };
    }) };
  }
  recover(): void {
    for (const row of this.all().filter(row => row.actorId === this.actorId)) {
      if (row.stage === 'following' || row.stage === 'replying') {
        this.patch(row.id, { stage: 'uncertain', actionError: '服务在请求期间停止，结果待确认；不会自动重发，请打开用户主页核对' });
        this.patchState({ pauseReason: '服务在互动请求期间停止，请核对结果后恢复；待确认的操作不会自动重发' });
      }
      if (row.checkState === 'checking') this.patch(row.id, { checkState: 'error', checkError: '上次检查被中断，可稍后手动检查' });
    }
    const job = this.state().checkJob;
    if (job?.status === 'running') this.patchState({ checkJob: { ...job, status: 'stopped' } });
  }
  private migrate(): void {
    if (this.read('outreach_accounts_v2', false)) return;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const old = this.read<Partial<OutreachConfig> | null>('outreach_config', null);
      if (old?.cookieId && old.actorId) {
        const { query: _query, ...legacy } = old as Partial<OutreachConfig> & { query?: string };
        const x = this.read<{ cookies?: { id: string; name: string }[] }>('x', {});
        const config: OutreachConfig = { ...DEFAULT_OUTREACH_CONFIG, ...legacy, id: `legacy-${old.actorId}`, name: x.cookies?.find(cookie => cookie.id === old.cookieId)?.name ?? '互关账户' };
        this.saveConfig(config);
        const oldState = this.read<OutreachState & { lastSearchAt?: string | null }>('outreach_state', { nextRequestAt: null, lastFetchedAt: null, pauseReason: null, checkJob: null });
        const { lastSearchAt: _lastSearchAt, ...state } = oldState;
        this.scope(config.id).patchState({ ...state, lastFetchedAt: null });
        this.write('outreach_dispatcher', { nextRequestAt: state.nextRequestAt, lastAccountId: config.id });
      }
      // Search candidates are not carried into the newly requested home-feed workflow.
      for (const row of this.all().filter(row => row.stage === 'pending_follow')) this.patch(row.id, { stage: 'skipped', actionError: '已改为首页发现，旧搜索候选不再执行' });
      this.write('outreach_accounts_v2', true);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}
