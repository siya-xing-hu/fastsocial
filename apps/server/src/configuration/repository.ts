import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  AccountConfiguration,
  AccountInput,
  InteractionPrompt,
  ManagedAccount,
  ManagedAccountProfile,
  PromptInput,
  XCookieInput,
} from "@fast-social/contracts";
import { ValidationError } from "../http/validation.ts";
import type { StoredXCookie } from "../repositories/settings-repository.ts";
import { DEFAULT_INTERACTION_PROMPTS } from "../default-interaction-prompts.ts";
import { AccountRequestLimits } from './request-limits.ts';

type Row = {
  id: string;
  name: string;
  username: string;
  actor_id: string;
  cookie: string;
  enabled: number;
  status: ManagedAccount["status"];
  last_checked_at: string | null;
  last_error: string | null;
  auto_translate: number;
};
type PromptRow = {
  id: string;
  name: string;
  scene: "post" | "reply";
  prompt: string;
  enabled: number;
};
export class ConfigurationRepository {
  private db: DatabaseSync;
  readonly requestLimits: AccountRequestLimits;
  constructor(db: DatabaseSync) {
    this.db = db;
    this.requestLimits = new AccountRequestLimits(db);
    if (
      !db
        .prepare(
          "SELECT key FROM settings WHERE key = 'configuration_tables_initialized'"
        )
        .get()
    ) {
      this.transaction(() => {
        db.prepare(
          "INSERT OR IGNORE INTO configurations(id,kind,name) VALUES ('auto-translate','auto_translate','自动翻译')"
        ).run();
        const read = (key: string): any => {
          const row = db
            .prepare("SELECT value FROM settings WHERE key=?")
            .get(key) as { value: string } | undefined;
          return row ? JSON.parse(row.value) : undefined;
        };
        const previous = read("interaction_prompts") as
          | InteractionPrompt[]
          | undefined;
        const prompts = previous ?? DEFAULT_INTERACTION_PROMPTS;
        this.writePrompts(
          prompts.map((p) => ({ ...p, prompt: normalizeVariables(p.prompt) }))
        );
        // Preserve existing credentials, but never guess which features an account should enable.
        const x = read("x");
        const cookies =
          x?.cookies ??
          (x?.cookie
            ? [
                {
                  id: "legacy-default",
                  name: "默认 Cookie",
                  cookie: x.cookie,
                  enabled: true,
                  status: "unchecked",
                },
              ]
            : []);
        for (const entry of cookies as StoredXCookie[])
          this.writeCookie({ ...entry, enabled: true });
        db.prepare(
          "INSERT INTO settings(key,value) VALUES ('configuration_tables_initialized','true')"
        ).run();
        db.prepare(
          "DELETE FROM settings WHERE key IN ('x','interaction_prompts','interaction_prompts_seeded')"
        ).run();
      });
    }
    if (!db.prepare("SELECT key FROM settings WHERE key='managed_account_profiles_v1'").get()) {
      this.transaction(() => {
        db.prepare("UPDATE managed_accounts SET auto_translate=EXISTS(SELECT 1 FROM account_config_bindings b WHERE b.account_id=managed_accounts.id AND b.config_id='auto-translate')").run();
        for (const account of this.rows()) {
          const previous = this.writingPreferences(account.id).assistant;
          // Preserve a unique language from older account-specific reply rules when no account language was set.
          const languages = new Set<string>();
          for (const row of db.prepare('SELECT value FROM workflows').all() as { value: string }[]) {
            const rule = JSON.parse(row.value);
            if (rule.accountId === account.id) for (const action of rule.actions ?? [])
              if (action.type === 'reply' && typeof action.targetLanguage === 'string' && action.targetLanguage.trim()) languages.add(action.targetLanguage.trim());
          }
          this.writeProfile(account.id, { primaryLanguage: previous?.language || (languages.size === 1 ? [...languages][0]! : 'zh-CN'), description: previous?.voice || '' });
        }
        db.prepare("DELETE FROM account_config_bindings WHERE config_id='auto-translate'").run();
        db.prepare("INSERT INTO settings(key,value) VALUES ('managed_account_profiles_v1','true')").run();
      });
    }
  }
  transaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  private rows(): Row[] {
    return this.db
      .prepare("SELECT * FROM managed_accounts ORDER BY rowid")
      .all() as unknown as Row[];
  }
  accounts(): ManagedAccount[] {
    return this.rows().map((row) => ({
      id: row.id,
      name: row.name,
      platform: "x",
      username: row.username,
      actorId: row.actor_id,
      cookieConfigured: !!row.cookie,
      status: row.status,
      autoTranslate: !!row.auto_translate,
      profile: this.profile(row.id),
      dailyLimits: this.requestLimits.limits(row.id),
      // Compatibility for older extension tabs; the boolean column is authoritative.
      configIds: [...this.bindings("account_id", row.id, "config_id").filter(id => id !== 'auto-translate'), ...(row.auto_translate ? ['auto-translate'] : [])],
      ...this.writingPreferences(row.id),
    }));
  }
  profile(id: string): ManagedAccountProfile {
    const row = this.db.prepare('SELECT primary_language,description FROM managed_account_profiles WHERE account_id=?').get(id) as { primary_language: string; description: string } | undefined;
    if (row) return { primaryLanguage: row.primary_language, description: row.description };
    const previous = this.writingPreferences(id).assistant;
    return { primaryLanguage: previous?.language || 'zh-CN', description: previous?.voice || '' };
  }
  private writeProfile(id: string, profile: ManagedAccountProfile): void {
    this.db.prepare(`INSERT INTO managed_account_profiles(account_id,primary_language,description) VALUES (?,?,?)
      ON CONFLICT(account_id) DO UPDATE SET primary_language=excluded.primary_language,description=excluded.description`)
      .run(id, profile.primaryLanguage.trim() || 'zh-CN', profile.description.trim());
  }
  setAutoTranslate(id: string, enabled: boolean): ManagedAccount {
    if (!this.rows().some(a => a.id === id)) throw new ValidationError('账号不存在');
    this.db.prepare('UPDATE managed_accounts SET auto_translate=? WHERE id=?').run(enabled ? 1 : 0, id);
    return this.accounts().find(a => a.id === id)!;
  }
  private writingPreferences(id: string): Pick<ManagedAccount, "assistant"> {
    const row = this.db.prepare("SELECT language,voice FROM account_writing_preferences WHERE account_id=?").get(id) as { language: string; voice: string } | undefined;
    const profile = this.db.prepare('SELECT primary_language,description FROM managed_account_profiles WHERE account_id=?').get(id) as { primary_language: string; description: string } | undefined;
    return row || profile ? { assistant: { language: profile?.primary_language ?? row!.language, voice: profile?.description ?? row!.voice } } : {};
  }
  private bindings(
    column: "account_id" | "config_id",
    id: string,
    select: "account_id" | "config_id"
  ): string[] {
    return (
      this.db
        .prepare(
          `SELECT ${select} AS id FROM account_config_bindings WHERE ${column}=?`
        )
        .all(id) as { id: string }[]
    ).map((r) => r.id);
  }
  prompts(): InteractionPrompt[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM configurations WHERE kind='prompt' ORDER BY sort_order,rowid"
        )
        .all() as unknown as PromptRow[]
    ).map((p) => ({
      id: p.id,
      name: p.name,
      scene: p.scene,
      prompt: p.prompt,
      enabled: Boolean(p.enabled),
      accountIds: this.bindings("config_id", p.id, "account_id"),
    }));
  }
  cookies(): StoredXCookie[] {
    return this.rows().map((r) => ({
      id: r.id,
      name: r.name,
      enabled: !!r.enabled,
      cookie: r.cookie,
      status: r.status,
      ...(r.last_checked_at ? { lastCheckedAt: r.last_checked_at } : {}),
      ...(r.last_error ? { lastError: r.last_error } : {}),
    }));
  }
  private assertIds(
    ids: string[],
    table: "managed_accounts" | "configurations"
  ): void {
    for (const id of ids)
      if (!this.db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(id))
        throw new ValidationError(
          table === "managed_accounts" ? "所选账号不存在" : "所选配置不存在"
        );
  }
  private bindAccount(id: string, ids: string[]): void {
    this.assertIds(ids, "configurations");
    this.db
      .prepare("DELETE FROM account_config_bindings WHERE account_id=?")
      .run(id);
    for (const key of new Set(ids.filter(id => id !== 'auto-translate')))
      this.db
        .prepare("INSERT INTO account_config_bindings VALUES (?,?)")
        .run(id, key);
  }
  private bindPrompt(id: string, ids: string[]): void {
    this.assertIds(ids, "managed_accounts");
    this.db
      .prepare("DELETE FROM account_config_bindings WHERE config_id=?")
      .run(id);
    for (const key of new Set(ids))
      this.db
        .prepare("INSERT INTO account_config_bindings VALUES (?,?)")
        .run(key, id);
  }
  saveAccount(input: AccountInput, id: string = randomUUID()): ManagedAccount {
    return this.transaction(() => {
      const current = this.rows().find((a) => a.id === id);
      const cookie =
        input.cookie === undefined
          ? current?.cookie ?? ""
          : input.cookie.trim();
      if (!cookie) throw new ValidationError("请填写账号 Cookie");
      if (!cookie.includes("auth_token=") || !cookie.includes("ct0="))
        throw new ValidationError("Cookie 需要包含 auth_token 和 ct0");
      const actorId = readActorId(cookie) || current?.actor_id || '',
        username = input.username.replace(/^@/, "").toLowerCase();
      if (
        this.rows().some(
          (a) =>
            a.id !== id &&
            (a.username.toLowerCase() === username ||
              (actorId && a.actor_id === actorId))
        )
      )
        throw new ValidationError("该账号已存在");
      if (current?.actor_id && actorId && current.actor_id !== actorId)
        throw new ValidationError("Cookie 不属于此账号，请单独添加账号");
      this.writeCookie({
        id,
        name: input.name,
        cookie,
        enabled: true,
        status: cookie === current?.cookie ? current.status : "unchecked",
      });
      this.db
        .prepare("UPDATE managed_accounts SET username=?,actor_id=? WHERE id=?")
        .run(username, actorId, id);
      this.requestLimits.bindActor(id);
      if (input.configIds !== undefined) this.bindAccount(id, input.configIds);
      const autoTranslate = input.autoTranslate ?? (input.configIds !== undefined ? input.configIds.includes('auto-translate') : !!current?.auto_translate);
      this.db.prepare('UPDATE managed_accounts SET auto_translate=? WHERE id=?').run(autoTranslate ? 1 : 0, id);
      if (input.assistant) this.db.prepare(`INSERT INTO account_writing_preferences(account_id,language,voice) VALUES (?,?,?)
        ON CONFLICT(account_id) DO UPDATE SET language=excluded.language,voice=excluded.voice`)
        .run(id, input.assistant.language, input.assistant.voice);
      if (input.profile) this.writeProfile(id, input.profile);
      else if (input.assistant) this.writeProfile(id, { primaryLanguage: input.assistant.language || this.profile(id).primaryLanguage, description: input.assistant.voice });
      else if (!current) this.writeProfile(id, this.profile(id));
      if (input.dailyLimits) this.requestLimits.save(id, input.dailyLimits);
      return this.accounts().find((a) => a.id === id)!;
    });
  }
  deleteAccount(id: string): void {
    this.db.prepare("DELETE FROM managed_accounts WHERE id=?").run(id);
  }
  savePrompt(input: PromptInput, id: string = randomUUID()): InteractionPrompt {
    return this.transaction(() => {
      const order = this.db
        .prepare(
          "SELECT COALESCE(MAX(sort_order),0)+1 AS value FROM configurations"
        )
        .get() as { value: number };
      this.db
        .prepare(
          `INSERT INTO configurations(id,kind,name,scene,prompt,sort_order) VALUES (?,'prompt',?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,scene=excluded.scene,prompt=excluded.prompt,enabled=1`
        )
        .run(id, input.name, input.scene, input.prompt, order.value);
      this.bindPrompt(id, input.accountIds);
      return this.prompts().find((p) => p.id === id)!;
    });
  }
  deletePrompt(id: string): void {
    this.db
      .prepare("DELETE FROM configurations WHERE id=? AND kind='prompt'")
      .run(id);
  }
  replacePrompts(prompts: InteractionPrompt[]): void {
    this.transaction(() => this.writePrompts(prompts));
  }
  private writePrompts(prompts: InteractionPrompt[]): void {
    if (
      new Set(prompts.map((p) => p.id)).size !== prompts.length ||
      prompts.some((p) => p.id === "auto-translate")
    )
      throw new ValidationError("Prompt 主键无效或重复");
    const ids = new Set(prompts.map((p) => p.id));
    for (const old of this.prompts())
      if (!ids.has(old.id)) this.deletePrompt(old.id);
    prompts.forEach((p, index) => {
      this.db
        .prepare(
          `INSERT INTO configurations(id,kind,name,scene,prompt,enabled,sort_order) VALUES (?,'prompt',?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,scene=excluded.scene,prompt=excluded.prompt,enabled=excluded.enabled,sort_order=excluded.sort_order`
        )
        .run(p.id, p.name, p.scene, p.prompt, p.enabled ? 1 : 0, index);
      if (p.accountIds) this.bindPrompt(p.id, p.accountIds);
    });
  }
  replaceCookies(cookies: XCookieInput[]): void {
    this.transaction(() => {
      const ids = new Set(cookies.map((c) => c.id));
      for (const old of this.rows())
        if (!ids.has(old.id)) this.deleteAccount(old.id);
      for (const c of cookies) this.writeCookie(c);
    });
  }
  private writeCookie(input: XCookieInput & Partial<StoredXCookie>): void {
    const old = this.rows().find((r) => r.id === input.id),
      cookie = input.cookie ?? old?.cookie ?? "",
      changed = cookie !== old?.cookie;
    let actor = readActorId(cookie) || old?.actor_id || '';
    // Older pools may contain the same account twice; retain secrets without inventing identities.
    if (
      actor &&
      this.rows().some((r) => r.id !== input.id && r.actor_id === actor)
    )
      actor = "";
    this.db
      .prepare(
        `INSERT INTO managed_accounts(id,name,cookie,actor_id,enabled,status,last_checked_at,last_error) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,cookie=excluded.cookie,actor_id=excluded.actor_id,enabled=excluded.enabled,status=excluded.status,last_checked_at=excluded.last_checked_at,last_error=excluded.last_error`
      )
      .run(
        input.id,
        input.name,
        cookie,
        actor,
        input.enabled ? 1 : 0,
        changed ? "unchecked" : old?.status ?? input.status ?? "unchecked",
        changed ? null : old?.last_checked_at ?? input.lastCheckedAt ?? null,
        changed ? null : old?.last_error ?? input.lastError ?? null
      );
    this.requestLimits.bindActor(input.id);
  }
  updateCookieStatus(
    id: string,
    cookie: string,
    status: ManagedAccount["status"],
    error?: string
  ): boolean {
    return (
      Number(
        this.db
          .prepare(
            "UPDATE managed_accounts SET status=?,last_checked_at=?,last_error=? WHERE id=? AND cookie=?"
          )
          .run(status, new Date().toISOString(), error ?? null, id, cookie)
          .changes
      ) > 0
    );
  }
  resolve(actorId: string, username: string): AccountConfiguration {
    // An explicit stable actor ID always wins; never apply a different account by username.
    const account = this.accounts().find((a) =>
      actorId
        ? a.actorId === actorId
        : !!username &&
          a.username.toLowerCase() === username.replace(/^@/, "").toLowerCase()
    );
    return {
      accountId: account?.id ?? null,
      autoTranslate: account?.autoTranslate ?? false,
      prompts: account
        ? this.prompts()
            .filter((p) => account.configIds.includes(p.id))
            .map((p) => ({ ...p, enabled: true }))
        : [],
    };
  }
}
export function readActorId(cookie: string): string {
  try {
    return (
      /^"?u=(\d+)"?$/.exec(
        decodeURIComponent(
          cookie
            .split(";")
            .map((s) => s.trim())
            .find((s) => s.startsWith("twid="))
            ?.slice(5) ?? ""
        )
      )?.[1] ?? ""
    );
  } catch {
    return "";
  }
}
export function normalizeVariables(text: string): string {
  return text
    .replace(/\{userContent\}/g, "{input}")
    .replace(/\{replyContent\}/g, "{reply}")
    .replace(/\{targetLang\}/g, "{{_tl_}}");
}
