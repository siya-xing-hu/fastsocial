import type { DatabaseSync } from 'node:sqlite';
import type { AccountProfile, MonitorBatchStatus, MonitorTestResult, PostDecision, SocialPost } from '@fast-social/contracts';

export class AccountRepository {
  private readonly database: DatabaseSync;
  constructor(database: DatabaseSync) { this.database = database; }
  profileByUsername(username: string): AccountProfile | null {
    const row = this.database.prepare('SELECT value FROM account_profiles WHERE username = ? COLLATE NOCASE').get(username) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : null;
  }
  profile(id: string): AccountProfile | null {
    const row = this.database.prepare('SELECT value FROM account_profiles WHERE id = ?').get(id) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : null;
  }
  saveProfile(profile: AccountProfile): void {
    this.database.prepare('INSERT INTO account_profiles (id, username, value) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET username=excluded.username, value=excluded.value')
      .run(profile.account.id, profile.account.username, JSON.stringify(profile));
  }
  savePosts(accountId: string, posts: SocialPost[]): void {
    const insert = this.database.prepare('INSERT INTO account_posts (account_id, post_id, created_at, value) VALUES (?, ?, ?, ?) ON CONFLICT(account_id, post_id) DO UPDATE SET value=excluded.value');
    this.transaction(() => { for (const post of posts) insert.run(accountId, post.id, post.createdAt, JSON.stringify(post)); });
  }
  posts(accountId: string, ids?: string[]): SocialPost[] {
    if (ids && !ids.length) return [];
    const rows = this.database.prepare(`SELECT value FROM account_posts WHERE account_id = ? ${ids ? `AND post_id IN (${ids.map(() => '?').join(',')})` : ''} ORDER BY created_at, post_id`)
      .all(accountId, ...(ids ?? [])) as { value: string }[];
    return rows.map(row => JSON.parse(row.value));
  }
  status(id: string): MonitorBatchStatus | null { return this.value('monitor_batch_status', id); }
  saveStatus(id: string, status: MonitorBatchStatus): void { this.saveValue('monitor_batch_status', id, status); }
  decisions(id: string): PostDecision[] { return this.value('monitor_decisions', id) ?? []; }
  saveDecisions(id: string, decisions: PostDecision[]): void { this.saveValue('monitor_decisions', id, decisions); }
  cachedTest(key: string): MonitorTestResult | null {
    const entry = this.value<{ at: number; result: MonitorTestResult }>('monitor_test_cache', key);
    return entry && Date.now() - entry.at < 86400000 ? entry.result : null;
  }
  cacheTest(key: string, result: MonitorTestResult): void {
    this.database.prepare('DELETE FROM monitor_test_cache WHERE updated_at < ?').run(new Date(Date.now() - 86400000).toISOString());
    this.saveValue('monitor_test_cache', key, { at: Date.now(), result });
  }
  delivered(ruleId: string, postId: string): boolean {
    return Boolean(this.database.prepare('SELECT 1 FROM notification_deliveries WHERE rule_id=? AND post_id=?').get(ruleId, postId));
  }
  markDelivered(ruleId: string, postId: string): void {
    this.database.prepare('INSERT OR IGNORE INTO notification_deliveries (rule_id, post_id, sent_at) VALUES (?, ?, ?)').run(ruleId, postId, new Date().toISOString());
  }
  prunePosts(accountId: string, username: string): void {
    const cursors = this.database.prepare('SELECT last_seen_post_id FROM monitors WHERE username = ? COLLATE NOCASE').all(username) as { last_seen_post_id: string | null }[];
    if (!cursors.length || cursors.some(row => !row.last_seen_post_id || !/^\d+$/.test(row.last_seen_post_id))) return;
    const boundary = cursors.map(row => BigInt(row.last_seen_post_id!)).reduce((a, b) => a < b ? a : b);
    const protectedIds = new Set(Object.values(this.profile(accountId)?.memory ?? {}).flatMap(fact => fact.evidenceIds));
    const cutoff = Date.now() - 30 * 86400000;
    const remove = this.database.prepare('DELETE FROM account_posts WHERE account_id=? AND post_id=?');
    for (const post of this.posts(accountId)) {
      if (Date.parse(post.createdAt) < cutoff && !protectedIds.has(post.id) && /^\d+$/.test(post.id) && BigInt(post.id) <= boundary) remove.run(accountId, post.id);
    }
  }
  transaction<T>(action: () => T): T {
    this.database.exec('BEGIN IMMEDIATE');
    try { const result = action(); this.database.exec('COMMIT'); return result; }
    catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }
  private value<T>(table: string, key: string): T | null {
    const row = this.database.prepare(`SELECT value FROM ${table} WHERE id=?`).get(key) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : null;
  }
  private saveValue(table: string, key: string, value: unknown): void {
    this.database.prepare(`INSERT INTO ${table} (id, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
      .run(key, JSON.stringify(value), new Date().toISOString());
  }
}
