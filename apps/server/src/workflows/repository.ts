import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  Workflow,
  WorkflowInput,
  WorkflowRecord,
} from "@fast-social/contracts";
import type { WorkflowCheckpoint } from './checkpoint.ts';

export class WorkflowRepository {
  private db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
    if (
      !db
        .prepare(
          "SELECT key FROM settings WHERE key='workflow_import_complete'"
        )
        .get()
    ) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const accounts = db
          .prepare("SELECT id FROM managed_accounts ORDER BY rowid")
          .all() as { id: string }[];
        const accountId = accounts.length === 1 ? accounts[0]!.id : "";
        const monitors = db.prepare("SELECT * FROM monitors").all() as {
          name: string;
          username: string;
          prompt: string;
          interval_minutes: number;
        }[];
        for (const m of monitors)
          this.save({
            name: m.name,
            accountId,
            source: "user",
            usernames: [m.username.replace(/^@/, "")],
            condition: m.prompt,
            intervalMinutes: m.interval_minutes,
            enabled: false,
            actions: [{ type: "notify", content: "" }],
          });
        const outreach = db
          .prepare("SELECT value FROM outreach_accounts")
          .all() as { value: string }[];
        for (const row of outreach) {
          const entry = JSON.parse(row.value);
          const c = entry.config ?? entry;
          if (
            typeof c.name !== "string" ||
            typeof c.prompt !== "string" ||
            typeof c.cookieId !== "string"
          )
            continue;
          this.save({
            name: c.name,
            accountId: c.cookieId,
            source: "home",
            usernames: [],
            condition: c.prompt,
            intervalMinutes: c.intervalMinutes ?? 30,
            enabled: false,
            actions: [
              { type: "follow" },
              ...(c.replyText
                ? [
                    {
                      type: "reply" as const,
                      mode: "text" as const,
                      text: c.replyText,
                    },
                  ]
                : []),
            ],
          });
        }
        db.prepare(
          "INSERT INTO settings VALUES ('workflow_import_complete','true')"
        ).run();
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    }
    if (!db.prepare("SELECT key FROM settings WHERE key='workflow_single_user_profiles_v1'").get()) {
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const original of this.list()) {
          if (original.source === 'home') continue;
          const names = [...new Set(original.usernames.map(u => u.replace(/^@/, '').toLowerCase()))];
          for (const [index, username] of names.entries()) {
            const id = index === 0 ? original.id : randomUUID();
            const legacy = db.prepare('SELECT last_seen_post_id FROM monitors WHERE username=? COLLATE NOCASE AND prompt=?').all(username, original.condition) as { last_seen_post_id: string | null }[];
            const seen = db.prepare('SELECT post_id FROM workflow_seen WHERE workflow_id=?').all(original.id) as { post_id: string }[];
            const cursors = [original.lastSeenPostId, ...seen.map(r => r.post_id), ...legacy.map(r => r.last_seen_post_id)].filter((v): v is string => !!v && /^\d+$/.test(v));
            const cursor = cursors.sort((a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0).at(-1) ?? null;
            this.write({ ...original, id, source: 'user', usernames: [username], name: names.length > 1 ? `${original.name} · @${username}` : original.name, lastSeenPostId: cursor });
            if (index > 0) {
              for (const item of seen) this.markSeen(id, item.post_id);
              const records = db.prepare('SELECT value FROM workflow_records WHERE workflow_id=?').all(original.id) as { value: string }[];
              for (const row of records) {
                const value = JSON.parse(row.value) as WorkflowRecord;
                if (value.post.author.replace(/^@/, '').toLowerCase() !== username) continue;
                value.workflowId = id;
                db.prepare('UPDATE workflow_records SET workflow_id=?,value=? WHERE id=?').run(id, JSON.stringify(value), value.id);
              }
            }
          }
        }
        db.prepare("INSERT INTO settings VALUES ('workflow_single_user_profiles_v1','true')").run();
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    if (!db.prepare("SELECT key FROM settings WHERE key='workflow_posts_only_cursor_v1'").get()) {
      db.exec('BEGIN IMMEDIATE');
      try {
        // The old high-water mark mixed Post and Reply IDs. Recover only evidenced,
        // processed original posts; never infer a Post checkpoint from a reply ID.
        for (const workflow of this.list()) {
          if (workflow.source !== 'user') continue;
          const rows = db.prepare(`SELECT p.post_id FROM account_posts p
            JOIN workflow_seen s ON s.post_id=p.post_id
            WHERE s.workflow_id=? AND json_extract(p.value,'$.author')=? COLLATE NOCASE
            AND json_extract(p.value,'$.type')='post'`).all(workflow.id, workflow.usernames[0]) as { post_id: string }[];
          const ids = rows.map(row => row.post_id).filter(id => /^\d+$/.test(id));
          const lastSeenPostId = ids.sort((a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0).at(-1) ?? null;
          this.write({ ...workflow, lastSeenPostId, postScan: null });
        }
        db.prepare("INSERT INTO settings VALUES ('workflow_posts_only_cursor_v1','true')").run();
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
  }
  list(): Workflow[] {
    return (
      this.db.prepare("SELECT value FROM workflows ORDER BY rowid").all() as {
        value: string;
      }[]
    ).map((r) => JSON.parse(r.value));
  }
  get(id: string): Workflow | undefined {
    return this.list().find((w) => w.id === id);
  }
  save(input: WorkflowInput, id: string = randomUUID()): Workflow {
    const current = this.get(id);
    const targetChanged = current && (current.source !== input.source || JSON.stringify(current.usernames) !== JSON.stringify(input.usernames));
    const value: Workflow = {
      ...input,
      id,
      createdAt: current?.createdAt ?? new Date().toISOString(),
      lastCheckedAt: targetChanged ? null : current?.lastCheckedAt ?? null,
      lastSeenPostId: targetChanged ? null : current?.lastSeenPostId ?? null,
      postScan: targetChanged || current?.accountId !== input.accountId ? null : current?.postScan ?? null,
      lastError: null,
      retryAt: null,
      resumeEnabledAfterFailure: false,
    };
    this.write(value);
    return value;
  }
  write(value: Workflow): void {
    this.db
      .prepare(
        "INSERT INTO workflows VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value"
      )
      .run(value.id, JSON.stringify(value));
  }
  remove(id: string): void {
    this.db.prepare("DELETE FROM workflows WHERE id=?").run(id);
  }
  seen(id: string, postId: string): boolean {
    return !!this.db
      .prepare(
        "SELECT post_id FROM workflow_seen WHERE workflow_id=? AND post_id=?"
      )
      .get(id, postId);
  }
  markSeen(id: string, postId: string): void {
    this.db
      .prepare("INSERT OR IGNORE INTO workflow_seen VALUES (?,?)")
      .run(id, postId);
  }
  records(id: string): WorkflowRecord[] {
    return (
      this.db
        .prepare(
          "SELECT value FROM workflow_records WHERE workflow_id=? ORDER BY rowid DESC LIMIT 100"
        )
        .all(id) as { value: string }[]
    ).map((r) => JSON.parse(r.value));
  }
  record(value: WorkflowRecord): void {
    this.db
      .prepare(
        "INSERT INTO workflow_records VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value"
      )
      .run(value.id, value.workflowId, JSON.stringify(value));
  }
  pending(id: string): WorkflowRecord[] {
    return (this.db.prepare("SELECT value FROM workflow_records WHERE workflow_id=? AND json_extract(value,'$.status')='pending' ORDER BY rowid")
      .all(id) as { value: string }[]).map(row => JSON.parse(row.value));
  }
  retryable(id: string): WorkflowRecord[] {
    return (this.db.prepare("SELECT value FROM workflow_records WHERE workflow_id=? AND json_extract(value,'$.status') IN ('failed','uncertain','pending') ORDER BY rowid")
      .all(id) as { value: string }[]).map(row => JSON.parse(row.value));
  }
  checkpoint(id: string): WorkflowCheckpoint | undefined {
    const row = this.db.prepare('SELECT value FROM workflow_checkpoints WHERE workflow_id=?').get(id) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : undefined;
  }
  checkpointRecords(checkpoint: WorkflowCheckpoint): WorkflowRecord[] {
    const read = this.db.prepare('SELECT value FROM workflow_records WHERE id=? AND workflow_id=?');
    return checkpoint.recordIds.map(id => {
      const row = read.get(id, checkpoint.run.workflowId) as { value: string } | undefined;
      if (!row) throw new Error('整轮任务的执行记录缺失，不能继续恢复');
      return JSON.parse(row.value) as WorkflowRecord;
    });
  }
  /** Publish the complete queue, seen IDs and counters together before any side effect. */
  saveCheckpoint(checkpoint: WorkflowCheckpoint, records: WorkflowRecord[] = [], seen: string[] = []): void {
    this.db.exec('SAVEPOINT workflow_checkpoint');
    try {
      for (const record of records) this.record(record);
      for (const postId of seen) this.markSeen(checkpoint.run.workflowId, postId);
      const revision = checkpoint.revision + 1;
      this.db.prepare('INSERT INTO workflow_checkpoints VALUES (?,?) ON CONFLICT(workflow_id) DO UPDATE SET value=excluded.value')
        .run(checkpoint.run.workflowId, JSON.stringify({ ...checkpoint, revision }));
      this.db.exec('RELEASE workflow_checkpoint');
      checkpoint.revision = revision;
    } catch (error) {
      this.db.exec('ROLLBACK TO workflow_checkpoint'); this.db.exec('RELEASE workflow_checkpoint'); throw error;
    }
  }
  recover(): void {
    for (const w of this.list()) {
      const checkpoint = this.checkpoint(w.id);
      const records = checkpoint ? this.checkpointRecords(checkpoint) : this.records(w.id);
      let interrupted = checkpoint?.run.status === 'running';
      for (const r of records)
        if (r.status === "running") {
          interrupted = true;
          r.status = r.actions.some(a => a.status === 'running') ? 'uncertain' : 'failed';
          r.actions.forEach((a) => {
            if (a.status === "running") a.status = "uncertain";
          });
          this.record(r);
        }
      if (interrupted) {
        const message = '上次执行中断，请手动恢复本轮任务。';
        if (checkpoint) {
          checkpoint.run.status = 'failed'; checkpoint.run.error = message;
          checkpoint.run.finishedAt = new Date().toISOString();
          this.saveCheckpoint(checkpoint);
        }
        this.write({
            ...w,
            enabled: false,
            resumeEnabledAfterFailure: w.resumeEnabledAfterFailure || w.enabled,
            lastError: message,
          });
      }
    }
  }
}
