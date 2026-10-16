import type { FollowingEntry, XProfileRelationship } from '@fast-social/contracts';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { SettingsRepository } from '../repositories/settings-repository.ts';
import type { OutreachIdentity } from '../outreach/types.ts';
import type { OutreachXClient } from '../outreach/x-client.ts';
import { AccountRequestLimitError } from '../configuration/request-limits.ts';
import { FollowingRepository } from './repository.ts';
import { trace, withTrace, errorDetails } from '../observability/trace.ts';
import { withQueuedXRequests } from '../adapters/x/request-queue.ts';

type Social = Pick<OutreachXClient, 'identity' | 'profile' | 'follow' | 'unfollow'>;
type Portrait = Required<Pick<FollowingEntry, 'summary' | 'summaryEvidence'>>;
export class FollowingService {
  private readonly repo: FollowingRepository;
  private readonly settings: SettingsRepository;
  private readonly x: Social;
  private readonly summarize: (accountId: string, profile: XProfileRelationship) => Promise<Portrait>;
  private locks = new Map<string, Promise<unknown>>();
  private jobs = new Map<string, Promise<void>>();
  private queue: Promise<void> = Promise.resolve();
  private deferredPortraits = new AsyncLocalStorage<Map<string, string>>();
  private stopping = false;
  constructor(repo: FollowingRepository, settings: SettingsRepository, x: Social,
    summarize: (accountId: string, profile: XProfileRelationship) => Promise<Portrait>) {
    this.repo = repo; this.settings = settings; this.x = x; this.summarize = summarize;
  }
  private identity(accountId: string): OutreachIdentity { return this.x.identity(accountId); }
  list(accountId: string, q = '') {
    const account = this.settings.configuration.accounts().find(a => a.id === accountId);
    if (!account?.actorId) throw new Error('请选择包含有效 X 身份的账号');
    return this.repo.list(account.actorId, q);
  }
  private entry(identity: OutreachIdentity, id: string): FollowingEntry {
    const entry = this.repo.get(identity.actorId, id);
    if (!entry) throw new Error('当前账号中没有这条关注记录');
    return entry;
  }
  editSummary(accountId: string, id: string, text: string): FollowingEntry {
    const entry = this.list(accountId).find(row => row.id === id);
    if (!entry) throw new Error('当前账号中没有这条关注记录');
    if (this.jobs.has(id) || ['pending', 'running'].includes(entry.summaryStatus)) throw new Error('画像正在更新，请完成后再保存');
    return this.repo.save({ ...entry, summary: text.trim(), summaryStatus: 'done', summaryError: null,
      summaryUpdatedAt: new Date().toISOString() });
  }
  private async lock<T>(key: string, work: () => Promise<T>): Promise<T> {
    if (this.stopping) throw new Error('服务正在停止');
    const previous = this.locks.get(key) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(work); this.locks.set(key, next);
    try { return await next; } finally { if (this.locks.get(key) === next) this.locks.delete(key); }
  }
  private confirm(entry: FollowingEntry, state: {following:boolean;followedBy:boolean|null}): FollowingEntry {
    const now = new Date().toISOString();
    return this.repo.save({ ...entry, status: state.following ? 'following' : 'not_following', followedBy: state.followedBy,
      followedAt: state.following ? entry.followedAt ?? now : entry.followedAt, updatedAt: now, checkedAt: now, error: null });
  }
  followSkipReason(identity: OutreachIdentity, userId: string, username: string, continuingNewFollow = false): string | null {
    if (userId === identity.actorId) return '跳过当前账号';
    const entry = this.repo.find(identity.actorId, { id: userId, username: username.replace(/^@/, '') });
    if (!entry) return null;
    if (entry.status === 'not_following') return '关注列表记录为已取消关注，不再自动关注或回复';
    if (entry.status === 'following') return continuingNewFollow ? null : '已经关注，跳过后续动作';
    return '关注记录待核对，跳过自动关注和回复';
  }
  retryFollow(identity: OutreachIdentity, userId: string, username: string) {
    return this.follow(identity, userId, username, undefined, 'workflow', true);
  }
  async follow(identity: OutreachIdentity, userId: string, username?: string, known?: XProfileRelationship, source: FollowingEntry['source'] = 'workflow', manualRetry = false) {
    if (!username) throw new Error('关注需要目标用户名以核对 Profile');
    return this.lock(identity.actorId, async () => {
      let entry = this.repo.find(identity.actorId, { id: userId, username });
      if (source === 'workflow') {
        const reason = this.followSkipReason(identity, userId, username);
        if (reason && !(manualRetry && entry && ['pending', 'uncertain'].includes(entry.status))) {
          trace('following.skipped', '跳过关注', { userId, username, reason });
          return { following: entry?.status === 'following', followedBy: entry?.followedBy ?? null, created: false, skipReason: reason };
        }
      }
      const existed = !!entry;
      trace('following.profile', '关注前核对 Profile', { userId, username, source });
      // A home-page snapshot can be stale. Confirm the current relation before a new automatic follow.
      const state = entry ? await this.x.profile(identity, username, userId) : known ?? await this.x.profile(identity, username, userId);
      trace('following.relationship', '当前关注关系', { userId, username, following: state.following, followedBy: state.followedBy });
      if (state.following && !entry && source === 'workflow')
        return { following: true, followedBy: state.followedBy, created: false, skipReason: '已经关注，跳过后续动作' };
      if (entry && ['pending', 'uncertain'].includes(entry.status) && !state?.following && !known && !manualRetry)
        throw new Error('这位用户有待核对的关注记录，请先在关注列表刷新关系');
      entry = entry ?? this.repo.create(identity.actorId, state?.account ?? { id: userId, username, name: username, bio: '', fetchedAt: '' }, source);
      if (state) entry.user = state.account;
      if (state?.following) {
        this.confirm(entry, state);
        if (source !== 'workflow' || manualRetry) this.enqueue(identity.cookieId, entry.id);
        return { following: true, followedBy: state.followedBy, created: false, skipReason: '已经关注，跳过后续动作' };
      }
      // Only a read can resolve a previous ambiguous request before another mutation is allowed.
      const previous = manualRetry && ['pending', 'uncertain'].includes(entry.status) ? entry : state ? this.confirm(entry, state) : entry;
      entry = this.repo.save({ ...previous, status: 'pending', error: null });
      try {
        const result = await this.x.follow(identity, userId, username);
        if (!result.following) throw new Error('Profile 尚未确认关注成功，请刷新核对');
        this.confirm(entry, result); this.enqueue(identity.cookieId, entry.id);
        trace('following.created', '新关注已确认并保存', { userId, username, entryId: entry.id, result });
        return { ...result, created: true };
      } catch (error) {
        // A quota refusal happens before sending. Do not turn a provisional row
        // into an apparent manual unfollow and block the deferred first follow.
        if (error instanceof AccountRequestLimitError && !existed) this.repo.removeUnsent(entry.id);
        else this.repo.save({ ...entry, status: error instanceof AccountRequestLimitError ? previous.status : 'uncertain',
          error: error instanceof Error ? error.message : String(error), updatedAt: new Date().toISOString() });
        throw error;
      }
    });
  }
  async add(accountId: string, username: string): Promise<FollowingEntry> {
    const identity = this.identity(accountId), profile = await this.x.profile(identity, username);
    if (profile.account.id === identity.actorId) throw new Error('不能关注当前账号自己');
    await this.follow(identity, profile.account.id, profile.account.username, profile, 'manual');
    return this.repo.find(identity.actorId, profile.account)!;
  }
  async unfollow(accountId: string, id: string): Promise<FollowingEntry> {
    const identity = this.identity(accountId);
    return this.lock(identity.actorId, async () => {
      let entry = this.entry(identity, id);
      const profile = await this.x.profile(identity, entry.user.username, entry.user.id || undefined);
      entry = this.confirm({ ...entry, user: profile.account }, profile);
      if (!profile.following) return entry;
      this.repo.save({ ...entry, status: 'pending', error: null });
      try { return this.confirm(entry, await this.x.unfollow(identity, profile.account.id, profile.account.username)); }
      catch (error) {
        this.repo.save({ ...entry, status: error instanceof AccountRequestLimitError ? entry.status : 'uncertain', error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    });
  }
  async refresh(accountId: string, id: string): Promise<FollowingEntry> {
    const identity = this.identity(accountId);
    return this.lock(identity.actorId, async () => {
      const entry = this.entry(identity, id);
      const profile = await this.x.profile(identity, entry.user.username, entry.user.id || undefined);
      return this.confirm({ ...entry, user: profile.account }, profile);
    });
  }
  /** Persist new portrait work immediately, but let this run finish its actions first. */
  async deferPortraits(work: () => Promise<void>): Promise<void> {
    if (this.deferredPortraits.getStore()) return work();
    const pending = new Map<string, string>();
    try { await this.deferredPortraits.run(pending, work); }
    finally {
      // This continuation runs outside the workflow's request guards and deferral scope.
      // A failed/edited workflow must not cancel enrichment of a confirmed follow.
      for (const [id, accountId] of pending) {
        try {
          // A separately confirmed manual update may already have completed this work.
          if (this.entry(this.identity(accountId), id).summaryStatus === 'pending') this.enqueue(accountId, id);
        }
        catch (error) { trace('portrait.error', '画像任务启动失败，保留待更新状态', { entryId: id, error: errorDetails(error) }); }
      }
    }
  }
  enqueue(accountId: string, id: string, options: { manual?: boolean } = {}): void {
    if (this.stopping || this.jobs.has(id)) return;
    const identity = this.identity(accountId), entry = this.entry(identity, id);
    // Manual callers receive a synchronous 429 before changing portrait state.
    // Actual requests still consume quota atomically at send time.
    if (options.manual) this.settings.configuration.requestLimits.assertAvailable(accountId, 'profile', 'posts');
    this.repo.save({ ...entry, summaryStatus: 'pending', summaryError: null });
    const deferred = this.deferredPortraits.getStore();
    if (deferred) {
      deferred.set(id, accountId);
      trace('portrait.deferred', '画像待更新，本轮监听动作结束后再抓取', { entryId: id, username: entry.user.username });
      return;
    }
    trace('portrait.queued', options.manual ? '启动手动画像更新' : '关注用户画像进入更新队列', { entryId: entry.id, username: entry.user.username });
    const work = async () => {
      if (this.stopping) return;
      trace('portrait.start', '开始更新关注用户画像');
      try {
        // Hold the actor lock only for the relationship read, not for AI generation.
        const current = await this.lock(identity.actorId, async () => {
          const saved = this.entry(identity, id);
          const profile = await this.x.profile(identity, saved.user.username, saved.user.id || undefined);
          // Enrichment must not overwrite a confirmed action with a potentially lagging profile read.
          return saved.checkedAt ? this.repo.save({ ...saved, user: profile.account }) : this.confirm({ ...saved, user: profile.account }, profile);
        });
        this.repo.save({ ...current, summaryStatus: 'running', summaryError: null });
        const portrait = await this.summarize(accountId, { account: current.user, following: current.status === 'following', followedBy: current.followedBy });
        const latest = this.entry(identity, id);
        this.repo.save({ ...latest, ...portrait, summaryStatus: 'done', summaryUpdatedAt: new Date().toISOString(), summaryError: null });
        trace('portrait.done', '关注用户画像已更新', portrait);
      } catch (error) {
        trace('portrait.error', '关注用户画像更新失败', { error: errorDetails(error) });
        const latest = this.entry(identity, id);
        this.repo.save({ ...latest, summaryStatus: 'failed', summaryError: error instanceof Error ? error.message : String(error) });
      }
    };
    const job = withTrace({ jobId: entry.id, job: 'following-portrait', accountId, actorId: identity.actorId, targetUserId: entry.user.id },
      () => (options.manual ? Promise.resolve().then(work) : withQueuedXRequests(() => this.queue.catch(() => {}).then(work)))
        .finally(() => { this.jobs.delete(id); }));
    this.jobs.set(id, job);
    if (!options.manual) this.queue = job;
  }
  start(): void {
    for (const entry of this.repo.all().filter(row => row.summaryStatus === 'pending')) {
      const account = this.settings.configuration.accounts().find(a => a.actorId === entry.actorId && a.cookieConfigured && a.status !== 'invalid');
      if (account) this.enqueue(account.id, entry.id);
    }
  }
  async stop(): Promise<void> { this.stopping = true; await Promise.allSettled([...this.locks.values(), ...this.jobs.values()]); }
}
