import type { DatabaseSync } from 'node:sqlite';
import { ACCOUNT_REQUEST_ACTIONS, ACCOUNT_REQUEST_LABELS, DEFAULT_ACCOUNT_DAILY_LIMITS,
  type AccountDailyLimits, type AccountRequestAction, type AccountRequestUsage } from '@fast-social/contracts';
import { ValidationError } from '../http/validation.ts';

export class AccountRequestLimitError extends Error {
  readonly code = 'ACCOUNT_DAILY_LIMIT';
  readonly resetsAt: string;
  constructor(name: string, action: AccountRequestAction, used: number, limit: number, resetsAt: string) {
    super(limit === 0 ? `账号「${name}」已禁止${ACCOUNT_REQUEST_LABELS[action]}，请在账号设置中调整每日额度`
      : `账号「${name}」的${ACCOUNT_REQUEST_LABELS[action]}每日额度已用尽（${used}/${limit}），北京时间次日 00:00 恢复`);
    this.resetsAt = resetsAt;
  }
}
export function validateDailyLimits(value: unknown): AccountDailyLimits {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError('每日额度格式无效');
  const input: Record<string, unknown> = { unfollow: DEFAULT_ACCOUNT_DAILY_LIMITS.unfollow, ...value as Record<string, unknown> };
  if (Object.keys(input).some(key => !ACCOUNT_REQUEST_ACTIONS.includes(key as AccountRequestAction))
    || ACCOUNT_REQUEST_ACTIONS.some(key => !Number.isSafeInteger(input[key]) || Number(input[key]) < 0 || Number(input[key]) > 100000))
    throw new ValidationError('每项每日额度必须为 0–100000 的整数；0 表示禁止该类请求');
  return Object.fromEntries(ACCOUNT_REQUEST_ACTIONS.map(key => [key, input[key]])) as AccountDailyLimits;
}

export class AccountRequestLimits {
  private readonly db: DatabaseSync;
  private readonly now: () => number;
  constructor(db: DatabaseSync, now = Date.now) { this.db = db; this.now = now; }
  limits(id: string): AccountDailyLimits {
    const row = this.db.prepare('SELECT value FROM account_request_limits WHERE account_id=?').get(id) as { value: string } | undefined;
    return { ...DEFAULT_ACCOUNT_DAILY_LIMITS, ...(row ? JSON.parse(row.value) : {}) };
  }
  save(id: string, limits: AccountDailyLimits): void {
    this.db.prepare('INSERT INTO account_request_limits VALUES (?,?) ON CONFLICT(account_id) DO UPDATE SET value=excluded.value')
      .run(id, JSON.stringify(validateDailyLimits(limits)));
  }
  bindActor(id: string): void {
    const { subject } = this.account(id), fallback = `account:${id}`;
    if (subject === fallback) return;
    this.db.prepare(`INSERT INTO account_request_usage(subject,day,action,used)
      SELECT ?,day,action,used FROM account_request_usage WHERE subject=?
      ON CONFLICT(subject,day,action) DO UPDATE SET used=used+excluded.used`).run(subject, fallback);
    this.db.prepare('DELETE FROM account_request_usage WHERE subject=?').run(fallback);
  }
  private account(id: string) {
    const account = this.db.prepare('SELECT name,actor_id FROM managed_accounts WHERE id=?').get(id) as { name: string; actor_id: string } | undefined;
    if (!account) throw new Error('账号不存在');
    return { ...account, subject: account.actor_id ? `actor:${account.actor_id}` : `account:${id}` };
  }
  private window() {
    const day = new Date(this.now() + 8 * 3600000).toISOString().slice(0, 10);
    return { day, resetsAt: new Date(Date.parse(`${day}T00:00:00+08:00`) + 86400000).toISOString() };
  }
  view(id: string): AccountRequestUsage {
    const { subject } = this.account(id), window = this.window();
    const used = Object.fromEntries(ACCOUNT_REQUEST_ACTIONS.map(action => [action, 0])) as AccountDailyLimits;
    // Retain requests made before a Cookie gained twid; stable actor IDs also survive delete/re-add.
    const rows = this.db.prepare('SELECT action,SUM(used) AS used FROM account_request_usage WHERE subject IN (?,?) AND day=? GROUP BY action')
      .all(subject, `account:${id}`, window.day) as { action: AccountRequestAction; used: number }[];
    for (const row of rows) used[row.action] = row.used;
    return { limits: this.limits(id), used, ...window };
  }
  consume(id: string, action: AccountRequestAction): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const account = this.account(id), usage = this.view(id);
      if (usage.used[action] >= usage.limits[action])
        throw new AccountRequestLimitError(account.name, action, usage.used[action], usage.limits[action], usage.resetsAt);
      this.db.prepare('INSERT INTO account_request_usage(subject,day,action,used) VALUES (?,?,?,1) ON CONFLICT(subject,day,action) DO UPDATE SET used=used+1')
        .run(account.subject, usage.day, action);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  assertAvailable(id: string, ...actions: AccountRequestAction[]): void {
    const account = this.account(id), usage = this.view(id);
    for (const action of actions) {
      if (usage.used[action] >= usage.limits[action])
        throw new AccountRequestLimitError(account.name, action, usage.used[action], usage.limits[action], usage.resetsAt);
    }
  }
}
