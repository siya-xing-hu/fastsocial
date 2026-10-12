import type { DatabaseSync } from "node:sqlite";

export function initializeSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS managed_accounts (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, username TEXT NOT NULL COLLATE NOCASE DEFAULT '',
      actor_id TEXT NOT NULL DEFAULT '', cookie TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'unchecked', last_checked_at TEXT, last_error TEXT
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS managed_account_username ON managed_accounts(username) WHERE username <> '';
    CREATE UNIQUE INDEX IF NOT EXISTS managed_account_actor ON managed_accounts(actor_id) WHERE actor_id <> '';
    CREATE TABLE IF NOT EXISTS configurations (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('auto_translate','prompt')),
      name TEXT NOT NULL, scene TEXT NOT NULL DEFAULT 'post', prompt TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0
    ) STRICT;
    CREATE TABLE IF NOT EXISTS account_config_bindings (
      account_id TEXT NOT NULL REFERENCES managed_accounts(id) ON DELETE CASCADE,
      config_id TEXT NOT NULL REFERENCES configurations(id) ON DELETE CASCADE,
      PRIMARY KEY(account_id, config_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS workflows (id TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS assistant_skills (
      id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE CHECK(key IN ('summary','post','reply')),
      name TEXT NOT NULL, description TEXT NOT NULL,
      file_path TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1,
      content_hash TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT ''
    ) STRICT;
    CREATE TABLE IF NOT EXISTS account_writing_preferences (
      account_id TEXT PRIMARY KEY REFERENCES managed_accounts(id) ON DELETE CASCADE,
      language TEXT NOT NULL DEFAULT '', voice TEXT NOT NULL DEFAULT '', posting_mode TEXT NOT NULL DEFAULT 'auto'
    ) STRICT;
    CREATE TABLE IF NOT EXISTS managed_account_profiles (
      account_id TEXT PRIMARY KEY REFERENCES managed_accounts(id) ON DELETE CASCADE,
      primary_language TEXT NOT NULL DEFAULT 'zh-CN', description TEXT NOT NULL DEFAULT ''
    ) STRICT;
    CREATE TABLE IF NOT EXISTS workflow_seen (workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE, post_id TEXT NOT NULL, PRIMARY KEY(workflow_id, post_id)) STRICT;
    CREATE TABLE IF NOT EXISTS account_request_limits (
      account_id TEXT PRIMARY KEY REFERENCES managed_accounts(id) ON DELETE CASCADE, value TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS account_request_usage (
      subject TEXT NOT NULL, day TEXT NOT NULL, action TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(subject, day, action)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS workflow_records (id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE, value TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS following_users (
      id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, target_id TEXT NOT NULL DEFAULT '',
      username TEXT NOT NULL COLLATE NOCASE, value TEXT NOT NULL
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS following_target ON following_users(actor_id,target_id) WHERE target_id <> '';
    CREATE UNIQUE INDEX IF NOT EXISTS following_username ON following_users(actor_id,username) WHERE target_id = '';

    CREATE TABLE IF NOT EXISTS outreach_accounts (
      id TEXT PRIMARY KEY, actor_id TEXT NOT NULL UNIQUE, value TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS outreach_records (
      id TEXT PRIMARY KEY, value TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS outreach_seen_posts (
      id TEXT PRIMARY KEY, seen_at TEXT NOT NULL
    ) STRICT;
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
  // Additive upgrades retain skill IDs, custom instructions and account preferences.
  for (const [table, column, sql] of [
    ['assistant_skills', 'file_path', "ALTER TABLE assistant_skills ADD COLUMN file_path TEXT NOT NULL DEFAULT ''"],
    ['assistant_skills', 'enabled', "ALTER TABLE assistant_skills ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1"],
    ['assistant_skills', 'content_hash', "ALTER TABLE assistant_skills ADD COLUMN content_hash TEXT NOT NULL DEFAULT ''"],
    ['assistant_skills', 'updated_at', "ALTER TABLE assistant_skills ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''"],
    ['managed_accounts', 'auto_translate', "ALTER TABLE managed_accounts ADD COLUMN auto_translate INTEGER NOT NULL DEFAULT 0"],
    ['account_writing_preferences', 'posting_mode', "ALTER TABLE account_writing_preferences ADD COLUMN posting_mode TEXT NOT NULL DEFAULT 'auto'"],
  ]) {
    if (!(database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some(c => c.name === column)) database.exec(sql);
  }
}
