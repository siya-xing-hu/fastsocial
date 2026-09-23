import type { DatabaseSync } from "node:sqlite";

export function initializeSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS account_profiles (
      id TEXT PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE, value TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS account_profiles_username ON account_profiles(username);
    CREATE TABLE IF NOT EXISTS account_posts (
      account_id TEXT NOT NULL, post_id TEXT NOT NULL, created_at TEXT NOT NULL, value TEXT NOT NULL,
      PRIMARY KEY(account_id, post_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS notification_deliveries (
      rule_id TEXT NOT NULL, post_id TEXT NOT NULL, sent_at TEXT NOT NULL,
      PRIMARY KEY(rule_id, post_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS monitor_batch_status (id TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS monitor_decisions (id TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS monitor_test_cache (id TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL) STRICT;

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS monitors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      platform TEXT NOT NULL,
      username TEXT NOT NULL,
      prompt TEXT NOT NULL,
      interval_minutes INTEGER NOT NULL,
      enabled INTEGER NOT NULL,
      last_seen_post_id TEXT,
      last_checked_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
  `);
}
