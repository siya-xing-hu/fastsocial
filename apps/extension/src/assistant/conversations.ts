import { assistantPageReference, type AssistantContext, type AssistantTurn, type SkillKey, type DraftValidation } from "@fast-social/contracts";

export interface ChatMessage extends AssistantTurn {
  id: string;
  createdAt: number;
  skill?: SkillKey;
  skillSource?: 'command' | 'inferred';
  validation?: DraftValidation;
  context?: AssistantContext;
  error?: string;
}
export interface Conversation {
  version: 1;
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  account: AssistantContext["account"] | null;
  messages: ChatMessage[];
  draft: string;
  pending: string | null;
}
interface StorageArea {
  get(keys: string | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}
export const CONVERSATION_PREFIX = "assistant.conversation.v1.";
const ACTIVE_KEY = "assistant.activeConversation.v1";
type Account = AssistantContext['account'] | null;
export function newConversation(account: Account = null): Conversation {
  const now = Date.now();
  return { version: 1, id: crypto.randomUUID(), title: "新会话", createdAt: now, updatedAt: now, account: account ? { ...account } : null, messages: [], draft: "", pending: null };
}
export function conversationTitle(text: string): string {
  return text.replace(/^\/(summary|post|reply)\s*/, "").replace(/\s+/g, " ").trim().slice(0, 36) || "新会话";
}
export function sameAccount(a: AssistantContext["account"] | null, b: AssistantContext["account"] | null): boolean {
  if (!a || !b) return !(a?.actorId || a?.username || b?.actorId || b?.username);
  if (a.actorId && b.actorId) return a.actorId === b.actorId;
  if (!a.actorId && !a.username && !b.actorId && !b.username) return true;
  return !!a.username && !!b.username && a.username.toLowerCase() === b.username.toLowerCase();
}
function accountKey(account: Account): string {
  return account?.actorId ? `id.${account.actorId}` : account?.username ? `name.${account.username.toLowerCase()}` : 'unknown';
}
export function conversationAccount(conversation: Conversation): Account {
  return conversation.account ?? [...conversation.messages].reverse().find(m => m.context?.account)?.context?.account ?? null;
}
// Store only the context needed to verify a draft; the entire timeline is not duplicated in chat history.
export function draftContext(context: AssistantContext): AssistantContext {
  return JSON.parse(JSON.stringify({ ...context, posts: [], selection: "", title: "" }));
}
// Retain source material separately from the fill guard, without duplicating a full timeline on every turn.
export function conversationReference(context: AssistantContext, skill?: SkillKey): string | undefined {
  const source = structuredClone(assistantPageReference(context, skill));
  if (!source.selection && !source.target && !source.posts.length && !source.draft) return undefined;
  const saved = { ...source, truncated: false };
  while (JSON.stringify(saved).length > 16000) {
    saved.truncated = true;
    if (saved.posts.length) { saved.posts.pop(); continue; }
    const longest = Math.max(saved.selection.length, saved.draft.length, saved.target?.text.length ?? 0);
    if (saved.selection.length === longest) saved.selection = saved.selection.slice(0, Math.floor(longest / 2));
    else if (saved.draft.length === longest) saved.draft = saved.draft.slice(0, Math.floor(longest / 2));
    else if (saved.target) saved.target.text = saved.target.text.slice(0, Math.floor(longest / 2));
  }
  return JSON.stringify(saved);
}
export function requestHistory(messages: ChatMessage[]): AssistantTurn[] {
  const turns: AssistantTurn[] = [];
  let size = 0;
  // Keep the full transcript in storage; send a bounded window to the model.
  for (let i = messages.length - 1; i >= 0 && turns.length < 24; i--) {
    const message = messages[i];
    if (message.error) continue;
    const content = message.content.slice(0, 50000);
    if (size + content.length > 60000) break;
    size += content.length;
    turns.unshift({ role: message.role, content, ...(message.skill ? { skill: message.skill } : {}),
      ...(message.role === 'user' && message.reference ? { reference: message.reference } : {}) });
  }
  while (turns[0]?.role === "assistant") turns.shift();
  // Conversation text takes priority. Keep each unchanged page snapshot only once in its chronological position.
  let remaining = 60000 - turns.reduce((n, turn) => n + turn.content.length, 0);
  const references = new Set<string>();
  for (const turn of turns) {
    if (!turn.reference) continue;
    if (turn.reference.length > 16000 || references.has(turn.reference) || turn.reference.length > remaining) delete turn.reference;
    else { references.add(turn.reference); remaining -= turn.reference.length; }
  }
  return turns;
}
function valid(value: unknown): value is Conversation {
  if (!value || typeof value !== "object") return false;
  const c = value as Conversation;
  return c.version === 1 && typeof c.id === "string" && /^[\w-]{1,100}$/.test(c.id)
    && typeof c.title === "string" && Number.isFinite(c.createdAt) && Number.isFinite(c.updatedAt)
    && typeof c.draft === "string" && (c.pending === null || typeof c.pending === "string")
    && Array.isArray(c.messages) && c.messages.every(m => m && typeof m.id === "string"
      && ["user", "assistant"].includes(m.role) && typeof m.content === "string");
}
export class ConversationStore {
  private storage: StorageArea;
  private activeKey: string;
  private queue = Promise.resolve();
  constructor(storage: StorageArea, tabId?: number) {
    this.storage = storage;
    this.activeKey = tabId === undefined ? ACTIVE_KEY : `${ACTIVE_KEY}.${tabId}`;
  }
  async list(account?: Account): Promise<Conversation[]> {
    await this.queue;
    const values = await this.storage.get(null);
    return Object.entries(values).flatMap(([key, value]) => key.startsWith(CONVERSATION_PREFIX) && valid(value) && key === CONVERSATION_PREFIX + value.id ? [{ ...value, account: conversationAccount(value) }] : [])
      .filter(c => account === undefined || sameAccount(c.account, account))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }
  async activeId(account?: Account): Promise<string | null> {
    await this.queue;
    const key = account === undefined ? this.activeKey : `${this.activeKey}.${accountKey(account)}`;
    const value = (await this.storage.get(key))[key];
    if (typeof value === 'string') return value;
    // Preserve a previous active conversation only for its original account.
    if (account !== undefined) {
      const legacy = (await this.storage.get(this.activeKey))[this.activeKey];
      if (typeof legacy === 'string' && (await this.list(account)).some(c => c.id === legacy)) return legacy;
    }
    return null;
  }
  private write(work: () => Promise<void>): Promise<void> {
    const pending = this.queue.then(work);
    // A failed write must not poison later saves, and callers still see its error.
    this.queue = pending.catch(() => {});
    return pending;
  }
  save(conversation: Conversation): Promise<void> {
    const snapshot: Conversation = JSON.parse(JSON.stringify(conversation));
    return this.write(() => this.storage.set({ [CONVERSATION_PREFIX + snapshot.id]: snapshot }));
  }
  activate(id: string, account?: Account): Promise<void> {
    const key = account === undefined ? this.activeKey : `${this.activeKey}.${accountKey(account)}`;
    return this.write(() => this.storage.set({ [key]: id }));
  }
  remove(id: string): Promise<void> { return this.write(() => this.storage.remove(CONVERSATION_PREFIX + id)); }
}
