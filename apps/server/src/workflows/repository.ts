import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  Workflow,
  WorkflowInput,
  WorkflowRecord,
} from "@fast-social/contracts";

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
      lastError: null,
      retryAt: null,
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
  recover(): void {
    for (const w of this.list())
      for (const r of this.records(w.id))
        if (r.status === "running") {
          r.status = "uncertain";
          r.actions.forEach((a) => {
            if (a.status === "running") a.status = "uncertain";
          });
          this.record(r);
          this.write({
            ...w,
            enabled: false,
            lastError: "上次执行中断，请核对执行记录后再启用。",
          });
        }
  }
}
