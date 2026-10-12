import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { FollowingEntry, SocialAccount, WorkflowRecord } from '@fast-social/contracts';

export class FollowingRepository {
  private readonly db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
    // Recover interrupted work without resending a social action.
    for (const entry of this.all()) {
      if (entry.status === 'pending') { entry.status = 'uncertain'; entry.error = '服务中断，请先刷新核对关注关系'; }
      if (entry.summaryStatus === 'running') entry.summaryStatus = 'pending';
      this.save(entry);
    }
    this.importHistory();
  }
  all(): FollowingEntry[] { return (this.db.prepare('SELECT value FROM following_users ORDER BY rowid DESC').all() as {value:string}[]).map(row => JSON.parse(row.value)); }
  list(actorId: string, search = ''): FollowingEntry[] {
    const q = search.trim().toLowerCase();
    return this.all().filter(row => row.actorId === actorId && (!q || [row.user.name, row.user.username, row.user.bio, row.summary].join('\n').toLowerCase().includes(q)));
  }
  get(actorId: string, id: string): FollowingEntry | undefined { return this.list(actorId).find(row => row.id === id); }
  find(actorId: string, user: Pick<SocialAccount, 'id' | 'username'>): FollowingEntry | undefined {
    return this.list(actorId).find(row => user.id && row.user.id === user.id
      || (!user.id || !row.user.id) && row.user.username.toLowerCase() === user.username.toLowerCase());
  }
  create(actorId: string, user: SocialAccount, source: FollowingEntry['source']): FollowingEntry {
    return { id: randomUUID(), actorId, user, source, status: 'uncertain', followedBy: null, followedAt: null, checkedAt: null,
      updatedAt: new Date().toISOString(), error: null, summary: '', summaryStatus: 'pending', summaryError: null, summaryUpdatedAt: null };
  }
  save(entry: FollowingEntry): FollowingEntry {
    this.db.prepare('INSERT INTO following_users(id,actor_id,target_id,username,value) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET target_id=excluded.target_id,username=excluded.username,value=excluded.value')
      .run(entry.id, entry.actorId, entry.user.id, entry.user.username, JSON.stringify(entry));
    return entry;
  }
  removeUnsent(id: string): void { this.db.prepare('DELETE FROM following_users WHERE id=?').run(id); }
  private importHistory(): void {
    if (this.db.prepare("SELECT key FROM settings WHERE key='following_history_v1'").get()) return;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const records = this.db.prepare('SELECT value FROM workflow_records').all() as {value:string}[];
      for (const row of records) {
        const record = JSON.parse(row.value) as WorkflowRecord;
        if (!record.accountId || !record.actions.some(a => a.type === 'follow' && ['done', 'uncertain'].includes(a.status) && a.result !== '跳过当前账号')) continue;
        const owner = this.db.prepare('SELECT actor_id FROM managed_accounts WHERE id=?').get(record.accountId) as {actor_id:string} | undefined;
        if (!owner?.actor_id) continue;
        const user = { id: record.resume?.userId ?? '', username: record.post.author.replace(/^@/, ''), name: record.post.author, bio: '', fetchedAt: '' };
        if (this.find(owner.actor_id, user)) continue;
        const entry = this.create(owner.actor_id, user, 'history');
        entry.followedAt = record.actions.some(a => a.type === 'follow' && a.status === 'done') ? record.createdAt : null;
        entry.error = '历史关注记录，等待核对当前关系';
        this.save(entry);
      }
      this.db.prepare("INSERT INTO settings VALUES ('following_history_v1','true')").run();
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}
