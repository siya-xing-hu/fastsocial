import { createHash } from 'node:crypto';
import type { AccountMemory, AccountProfile, AccountProfileView, Monitor, MonitorBatchStatus, MonitorTestResult, PostDecision, SocialAccount, SocialPost } from '@fast-social/contracts';
import type { SocialAdapter } from '../adapters/social-adapter.ts';
import { activeMemory, bioSource, INPUT_BUDGET, inputSize, MAX_BATCH_POSTS, MEMORY_LIMIT, SECTIONS, estimateTokens, type BatchInput, type BatchMatcher } from '../ai/batch-matcher.ts';
import type { AccountRepository } from '../repositories/account-repository.ts';
import type { MonitorRepository } from '../repositories/monitor-repository.ts';
import type { TelegramNotifier } from '../telegram/telegram-notifier.ts';

interface RunnerDependencies {
  monitors: MonitorRepository; social: SocialAdapter; matcher: BatchMatcher;
  accounts: AccountRepository; telegram: TelegramNotifier;
}
export class MonitorRunner {
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly dependencies: RunnerDependencies;
  constructor(dependencies: RunnerDependencies) { this.dependencies = dependencies; }

  async run(id: string): Promise<void> { return this.runMany([id]); }
  async runMany(ids: string[]): Promise<void> {
    const groups = new Map<string, string[]>();
    for (const id of ids) {
      const monitor = this.dependencies.monitors.get(id);
      if (!monitor?.enabled) continue;
      const key = monitor.username.toLowerCase();
      groups.set(key, [...(groups.get(key) ?? []), id]);
    }
    await Promise.all([...groups].map(([key, group]) => this.lock(key, () => this.runGroup(group))));
  }

  profile(id: string): AccountProfileView {
    const monitor = this.requireMonitor(id);
    const profile = this.dependencies.accounts.profileByUsername(monitor.username);
    const evidenceIds = [...new Set(Object.values(profile?.memory ?? {}).flatMap(fact => fact.evidenceIds).filter(id => !id.startsWith('bio:') && id !== 'manual'))];
    return { profile: profile ? { ...profile, memory: activeMemory(profile.memory) } : null,
      evidence: profile ? this.dependencies.accounts.posts(profile.account.id, evidenceIds) : [],
      status: this.dependencies.accounts.status(id) };
  }

  async editProfile(id: string, text: string): Promise<AccountProfileView> {
    const monitor = this.requireMonitor(id);
    return this.lock(monitor.username.toLowerCase(), async () => {
      const profile = this.dependencies.accounts.profileByUsername(monitor.username);
      if (!profile) throw new Error('账号尚未完成首次学习');
      if ([...text].length > MEMORY_LIMIT) throw new Error('画像最多 250 字');
      const lines = text.trim().split('\n').filter(Boolean);
      if (lines.length > 4) throw new Error('画像最多四行：背景、主题、用语、近况');
      const memory: AccountMemory = {};
      const labels = ['背景', '主题', '用语', '近况'];
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index]!;
        const labeled = labels.findIndex(label => line.startsWith(`${label}：`) || line.startsWith(`${label}:`));
        const section = SECTIONS[labeled >= 0 ? labeled : index]!;
        const content = line.replace(/^(背景|主题|用语|近况)[:：]\s*/, '').trim();
        if (content) memory[section] = { text: content, evidenceIds: ['manual'], kind: 'manual', updatedAt: new Date().toISOString() };
      }
      this.dependencies.accounts.saveProfile({ ...profile, memory, version: profile.version + 1, updatedAt: new Date().toISOString() });
      return this.profile(id);
    });
  }

  async test(id: string): Promise<MonitorTestResult> {
    const monitor = this.requireMonitor(id);
    return this.lock(monitor.username.toLowerCase(), async () => {
      const { account, profile } = await this.account(monitor.username);
      const posts = await this.fetchWindow(account, null, 20, false);
      if (!posts.length) throw new Error('没有找到可测试的帖子');
      const memory = activeMemory(profile?.memory ?? {});
      const key = createHash('sha256').update(JSON.stringify({ account, posts, memory, version: profile?.version, prompt: monitor.prompt, id, model: this.dependencies.matcher.fingerprint() }, (key, value) => key === 'fetchedAt' ? undefined : value)).digest('hex');
      const cached = this.dependencies.accounts.cachedTest(key);
      if (cached) return { ...cached, cached: true };
      const result = await this.analyze(account, memory, posts, [{ ...monitor, lastSeenPostId: null }], true, false, this.support(profile));
      const latest = posts.at(-1)!;
      const latestDecision = result.decisions.find(item => item.postId === latest.id);
      const response: MonitorTestResult = {
        post: latest, evaluation: { matched: latestDecision?.status === 'match', message: latestDecision?.reason ?? '' },
        posts, decisions: result.decisions, memory: result.memory, profileVersion: profile?.version ?? 0, cached: false,
      };
      this.dependencies.accounts.cacheTest(key, response);
      return response;
    });
  }

  private async runGroup(ids: string[]): Promise<void> {
    const { monitors, accounts, telegram } = this.dependencies;
    const rules = ids.map(id => this.requireMonitor(id)).filter(rule => rule.enabled);
    if (!rules.length) return;
    const status: MonitorBatchStatus = { fetched: 0, analyzed: 0, matched: 0, uncertain: 0, pending: 0, phase: 'fetch', error: null, checkedAt: new Date().toISOString() };
    let candidates: SocialPost[] = [];
    try {
      const { account, profile } = await this.account(rules[0]!.username);
      const newRules = new Set(rules.filter(rule => this.isNew(rule)).map(rule => rule.id));
      const boundary = earliestCursor(rules.filter(rule => !newRules.has(rule.id)));
      const needsLearning = !profile?.initialized;
      const window = await this.fetchWindow(account, boundary, needsLearning || rules.some(rule => newRules.has(rule.id)) ? 20 : 0, true);
      status.fetched = window.length;
      const baseline = window.at(-1)?.id ?? null;
      // A fresh rule only learns its snapshot; migrated rules retain their existing boundary.
      const activeRules = rules.filter(rule => !newRules.has(rule.id));
      const fresh = window.filter(post => activeRules.some(rule => after(post.id, rule.lastSeenPostId)));
      const learning = needsLearning ? window.slice(-20) : [];
      candidates = uniquePosts([...learning, ...fresh]);
      const bioChanged = profile?.bioSource !== bioSource(account);
      status.pending = fresh.length;
      status.phase = needsLearning ? 'learn' : 'analyze';
      const result = candidates.length || bioChanged || needsLearning
        ? await this.analyze(account, activeMemory(profile?.memory ?? {}), candidates, activeRules, bioChanged || needsLearning, true, this.support(profile))
        : { decisions: [] as PostDecision[], memory: activeMemory(profile?.memory ?? {}) };
      // Do not commit results or send notifications for a rule edited while requests were in flight.
      this.ensureUnchanged(rules);
      status.analyzed = fresh.length;
      status.matched = result.decisions.filter(item => item.status === 'match').length;
      status.uncertain = result.decisions.filter(item => item.status === 'uncertain').length;
      status.phase = 'notify';
      for (const decision of result.decisions) {
        if (decision.status !== 'match' || accounts.delivered(decision.ruleId, decision.postId)) continue;
        this.ensureUnchanged(rules);
        const post = candidates.find(post => post.id === decision.postId)!;
        const evidence = accounts.posts(account.id, decision.evidenceIds).filter(item => item.id !== post.id);
        const message = [decision.reason, decision.eventTime ? `时间：${decision.eventTime}` : '', ...evidence.slice(0, 2).map(item => `依据：${item.text.slice(0, 160)}\n${item.url}`)].filter(Boolean).join('\n');
        await telegram.send(message, post);
        accounts.markDelivered(decision.ruleId, decision.postId);
      }
      this.ensureUnchanged(rules);
      status.phase = 'done'; status.pending = 0;
      accounts.transaction(() => {
        const next: AccountProfile = { account, memory: result.memory, initialized: true,
          version: (profile?.version ?? 0) + (JSON.stringify(profile?.memory) !== JSON.stringify(result.memory) ? 1 : 0),
          bioSource: bioSource(account), updatedAt: new Date().toISOString() };
        accounts.saveProfile(next);
        for (const rule of rules) {
          const decisions = result.decisions.filter(item => item.ruleId === rule.id);
          accounts.saveDecisions(rule.id, decisions);
          accounts.saveStatus(rule.id, { ...status, analyzed: decisions.length, matched: decisions.filter(item => item.status === 'match').length, uncertain: decisions.filter(item => item.status === 'uncertain').length });
          monitors.updateRunState(rule.id, { lastSeenPostId: baseline && after(baseline, rule.lastSeenPostId) ? baseline : rule.lastSeenPostId, lastCheckedAt: status.checkedAt, lastError: null });
        }
        accounts.prunePosts(account.id, account.username);
      });
    } catch (error) {
      status.error = error instanceof Error ? error.message : String(error);
      // No recovery queue and no cursor movement on failure: the next scheduled run re-fetches the window.
      for (const rule of rules) {
        if (!sameRule(rule, monitors.get(rule.id))) continue;
        accounts.saveStatus(rule.id, { ...status, baselinePending: this.isNew(rule) });
        monitors.updateRunState(rule.id, { lastCheckedAt: status.checkedAt, lastError: status.error });
      }
      throw error;
    }
  }

  private async account(username: string): Promise<{ account: SocialAccount; profile: AccountProfile | null }> {
    const profile = this.dependencies.accounts.profileByUsername(username);
    if (profile && Date.now() - Date.parse(profile.account.fetchedAt) < 86400000) return { account: profile.account, profile };
    if (!this.dependencies.social.fetchAccount) throw new Error('平台适配器不支持账号简介');
    const account = await this.dependencies.social.fetchAccount(username);
    return { account, profile: this.dependencies.accounts.profile(account.id) };
  }

  private async fetchWindow(account: SocialAccount, boundary: string | null, minimum: number, persist: boolean): Promise<SocialPost[]> {
    const results = await Promise.allSettled((['posts', 'replies'] as const).map(surface => this.fetchStream(account, boundary, minimum, persist, surface)));
    const failure = results.find(result => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    const combined = uniquePosts(results.flatMap(result => result.status === 'fulfilled' ? result.value : []));
    return boundary || !minimum ? combined : combined.slice(-minimum);
  }

  private async fetchStream(account: SocialAccount, boundary: string | null, minimum: number, persist: boolean, surface: 'posts' | 'replies'): Promise<SocialPost[]> {
    const { social, accounts } = this.dependencies;
    if (!social.fetchTimelinePage) throw new Error('平台适配器不支持时间线分页');
    const posts = new Map<string, SocialPost>();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    for (let pageNumber = 0; pageNumber < 50; pageNumber += 1) {
      const page = await social.fetchTimelinePage(account, cursor, surface);
      if (persist) accounts.savePosts(account.id, page.posts);
      for (const post of page.posts) posts.set(post.id, post);
      const ordered = uniquePosts([...posts.values()]);
      const covered = boundary ? page.posts.length > 0 && page.posts.every(post => !after(post.id, boundary)) : minimum > 0 && ordered.length >= minimum;
      if (!page.nextCursor || page.posts.length === 0 || (covered && ordered.length >= minimum)) {
        if (!boundary) return minimum ? ordered.slice(-minimum) : ordered;
        const learningIds = new Set(minimum ? ordered.slice(-minimum).map(post => post.id) : []);
        return ordered.filter(post => after(post.id, boundary) || learningIds.has(post.id));
      }
      if (cursors.has(page.nextCursor)) throw new Error('X 分页游标重复，本轮抓取不完整；监听偏移量保持不变');
      cursors.add(page.nextCursor); cursor = page.nextCursor;
    }
    throw new Error('X 本轮分页达到 50 页，未确认完整范围；监听偏移量保持不变');
  }

  private support(profile: AccountProfile | null): SocialPost[] {
    if (!profile) return [];
    const memory = activeMemory(profile.memory);
    const ids = [...new Set([...(memory.language?.evidenceIds ?? []), ...(memory.recent?.evidenceIds ?? [])])].filter(id => !id.startsWith('bio:') && id !== 'manual');
    return this.dependencies.accounts.posts(profile.account.id, ids).filter(post => estimateTokens(JSON.stringify(post)) < 1000).slice(-2);
  }

  private async analyze(account: SocialAccount, initial: AccountMemory, posts: SocialPost[], rules: Monitor[], includeBio: boolean, excludeBaselines: boolean, support: SocialPost[] = []): Promise<{ memory: AccountMemory; decisions: PostDecision[] }> {
    let memory = initial;
    const decisions: PostDecision[] = [];
    let offset = 0;
    let batchCount = 0;
    let context: SocialPost[] = support.filter(post => !posts.some(item => item.id === post.id));
    do {
      let batch: SocialPost[] = [];
      const input = (current: SocialPost[]): BatchInput => ({ account, memory, posts: current, context,
        rules: rules.map(rule => ({ id: rule.id, prompt: rule.prompt, postIds: current.filter(post => !excludeBaselines || after(post.id, rule.lastSeenPostId)).map(post => post.id) })).filter(rule => rule.postIds.length), includeBio });
      while (offset + batch.length < posts.length && batch.length < MAX_BATCH_POSTS) {
        const proposed = [...batch, posts[offset + batch.length]!];
        if (inputSize(input(proposed)) > INPUT_BUDGET) break;
        batch = proposed;
      }
      if (!batch.length && posts.length > offset) {
        // Context may be dropped to fit a long post; source text is never silently cut.
        if (context.length) { context = []; continue; }
        throw new Error('单帖或监听规则超出批次输入预算；请缩短规则，监听偏移量保持不变');
      }
      const result = await this.dependencies.matcher.analyze(input(batch));
      batchCount += 1;
      if (result.memory) memory = result.memory;
      decisions.push(...result.decisions);
      offset += batch.length;
      context = batch.slice(-2);
      includeBio = false;
    } while (offset < posts.length);
    // Only ambiguous posts get one final review when later batches may resolve them.
    if (batchCount > 1) {
      const uncertain = decisions.filter(item => item.status === 'uncertain');
      const reviewPosts = posts.filter(post => uncertain.some(item => item.postId === post.id));
      const review: BatchInput = { account, memory, posts: reviewPosts, context,
        rules: rules.map(rule => ({ id: rule.id, prompt: rule.prompt, postIds: uncertain.filter(item => item.ruleId === rule.id).map(item => item.postId) })).filter(rule => rule.postIds.length), includeBio: false };
      if (reviewPosts.length && reviewPosts.length <= MAX_BATCH_POSTS && inputSize(review) <= INPUT_BUDGET) {
        const result = await this.dependencies.matcher.analyze(review);
        for (const decision of result.decisions) decisions.splice(decisions.findIndex(item => item.ruleId === decision.ruleId && item.postId === decision.postId), 1, decision);
      }
    }
    return { memory, decisions };
  }

  private isNew(rule: Monitor): boolean {
    const status = this.dependencies.accounts.status(rule.id);
    return !rule.lastSeenPostId && (!rule.lastCheckedAt || Boolean(status?.baselinePending) || (!status && Boolean(rule.lastError)));
  }

  private requireMonitor(id: string): Monitor {
    const monitor = this.dependencies.monitors.get(id);
    if (!monitor) throw new Error('监控规则不存在');
    return monitor;
  }
  private ensureUnchanged(rules: Monitor[]): void {
    if (rules.some(rule => !sameRule(rule, this.dependencies.monitors.get(rule.id)))) throw new Error('监听规则已修改，本轮结果未提交');
  }
  private async lock<T>(key: string, action: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const pending = previous.catch(() => {}).then(action);
    this.locks.set(key, pending);
    try { return await pending; } finally { if (this.locks.get(key) === pending) this.locks.delete(key); }
  }
}
function sameRule(left: Monitor, right: Monitor | null): boolean { return Boolean(right && left.username === right.username && left.prompt === right.prompt && left.name === right.name && left.enabled === right.enabled && left.intervalMinutes === right.intervalMinutes && left.lastSeenPostId === right.lastSeenPostId); }
export function after(id: string, cursor: string | null): boolean { if (!cursor) return true; try { return BigInt(id) > BigInt(cursor); } catch { return id.localeCompare(cursor) > 0; } }
function earliestCursor(rules: Monitor[]): string | null { const existing = rules; if (!existing.length || existing.some(rule => !rule.lastSeenPostId)) return null; return existing.map(rule => rule.lastSeenPostId!).sort((a, b) => after(a, b) ? 1 : a === b ? 0 : -1)[0]!; }
function uniquePosts(posts: SocialPost[]): SocialPost[] { return [...new Map(posts.map(post => [post.id, post])).values()].sort((a, b) => after(a.id, b.id) ? 1 : a.id === b.id ? 0 : -1); }
