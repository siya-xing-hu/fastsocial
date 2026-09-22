import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  CreateMonitorInput,
  Monitor,
  UpdateMonitorInput,
} from "@fast-social/contracts";

interface MonitorRow {
  id: string;
  name: string;
  platform: string;
  username: string;
  prompt: string;
  interval_minutes: number;
  enabled: number;
  last_seen_post_id: string | null;
  last_checked_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export class MonitorRepository {
  private readonly database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.database = database;
  }

  list(): Monitor[] {
    const rows = this.database
      .prepare("SELECT * FROM monitors ORDER BY created_at ASC")
      .all() as unknown as MonitorRow[];
    return rows.map(mapMonitor);
  }

  get(id: string): Monitor | null {
    const row = this.database
      .prepare("SELECT * FROM monitors WHERE id = ?")
      .get(id) as unknown as MonitorRow | undefined;
    return row ? mapMonitor(row) : null;
  }

  create(input: CreateMonitorInput): Monitor {
    const now = new Date().toISOString();
    const monitor: Monitor = {
      id: randomUUID(),
      name: input.name.trim(),
      platform: input.platform ?? "x",
      username: normalizeUsername(input.username),
      prompt: input.prompt.trim(),
      intervalMinutes: input.intervalMinutes,
      enabled: input.enabled ?? true,
      lastSeenPostId: null,
      lastCheckedAt: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };

    this.database
      .prepare(`
        INSERT INTO monitors (
          id, name, platform, username, prompt, interval_minutes, enabled,
          last_seen_post_id, last_checked_at, last_error, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        monitor.id,
        monitor.name,
        monitor.platform,
        monitor.username,
        monitor.prompt,
        monitor.intervalMinutes,
        monitor.enabled ? 1 : 0,
        monitor.lastSeenPostId,
        monitor.lastCheckedAt,
        monitor.lastError,
        monitor.createdAt,
        monitor.updatedAt,
      );
    return monitor;
  }

  update(id: string, input: UpdateMonitorInput): Monitor | null {
    const current = this.get(id);
    if (!current) return null;
    const updated: Monitor = {
      ...current,
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.platform !== undefined ? { platform: input.platform } : {}),
      ...(input.username !== undefined
        ? { username: normalizeUsername(input.username) }
        : {}),
      ...(input.prompt !== undefined ? { prompt: input.prompt.trim() } : {}),
      ...(input.intervalMinutes !== undefined
        ? { intervalMinutes: input.intervalMinutes }
        : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      updatedAt: new Date().toISOString(),
    };
    if (
      input.username !== undefined &&
      normalizeUsername(input.username).toLowerCase() !== current.username.toLowerCase()
    ) {
      updated.lastSeenPostId = null;
      updated.lastCheckedAt = null;
      updated.lastError = null;
    }
    this.write(updated);
    return updated;
  }

  updateRunState(
    id: string,
    state: {
      lastSeenPostId?: string | null;
      lastCheckedAt?: string | null;
      lastError?: string | null;
    },
  ): Monitor | null {
    const current = this.get(id);
    if (!current) return null;
    const updated: Monitor = {
      ...current,
      ...(state.lastSeenPostId !== undefined
        ? { lastSeenPostId: state.lastSeenPostId }
        : {}),
      ...(state.lastCheckedAt !== undefined
        ? { lastCheckedAt: state.lastCheckedAt }
        : {}),
      ...(state.lastError !== undefined ? { lastError: state.lastError } : {}),
      updatedAt: new Date().toISOString(),
    };
    this.write(updated);
    return updated;
  }

  delete(id: string): boolean {
    const result = this.database
      .prepare("DELETE FROM monitors WHERE id = ?")
      .run(id);
    return result.changes > 0;
  }

  private write(monitor: Monitor): void {
    this.database
      .prepare(`
        UPDATE monitors SET
          name = ?, platform = ?, username = ?, prompt = ?,
          interval_minutes = ?, enabled = ?, last_seen_post_id = ?,
          last_checked_at = ?, last_error = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(
        monitor.name,
        monitor.platform,
        monitor.username,
        monitor.prompt,
        monitor.intervalMinutes,
        monitor.enabled ? 1 : 0,
        monitor.lastSeenPostId,
        monitor.lastCheckedAt,
        monitor.lastError,
        monitor.updatedAt,
        monitor.id,
      );
  }
}

function normalizeUsername(username: string): string {
  return username.trim().replace(/^@/, "");
}

function mapMonitor(row: MonitorRow): Monitor {
  return {
    id: row.id,
    name: row.name,
    platform: "x",
    username: row.username,
    prompt: row.prompt,
    intervalMinutes: row.interval_minutes,
    enabled: row.enabled === 1,
    lastSeenPostId: row.last_seen_post_id,
    lastCheckedAt: row.last_checked_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
