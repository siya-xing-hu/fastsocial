import { createHash } from 'node:crypto';
import type { AccountMemory, AccountProfile, AccountProfileView, Monitor, MonitorBatchStatus, MonitorTestResult, PostDecision, SocialAccount, SocialPost, Workflow } from '@fast-social/contracts';
import type { SocialAdapter } from '../adapters/social-adapter.ts';
import { activeMemory, bioSource, INPUT_BUDGET, inputSize, MAX_BATCH_POSTS, SECTIONS, estimateTokens, type BatchInput, type BatchMatcher } from '../ai/batch-matcher.ts';
import type { AccountRepository } from '../repositories/account-repository.ts';
import type { MonitorRepository } from '../repositories/monitor-repository.ts';
import type { TelegramNotifier } from '../telegram/telegram-notifier.ts';
import type { ReportAnalysisProgress } from '../workflows/progress.ts';
import { trace } from '../observability/trace.ts';
import { portraitInput } from '../ai/portrait.ts';
import { withQueuedXRequests } from '../adapters/x/request-queue.ts';

interface RunnerDependencies {
  monitors: MonitorRepository; social: SocialAdapter; matcher: BatchMatcher;
  accounts: AccountRepository; telegram: TelegramNotifier;
}
export interface UserWorkflowBatch { posts: SocialPost[]; decisions: PostDecision[]; memory: AccountMemory; profile: AccountProfile; cursor: string | null; postScan: Workflow['postScan']; status: MonitorBatchStatus }
export const MAX_WORKFLOW_TIMELINE_PAGES = 5;
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
    await withQueuedXRequests(() => Promise.all([...groups].map(([key, group]) => this.lock(key, () => this.runGroup(group)))));
  }

  profile(id: string): AccountProfileView {
    const monitor = this.requireMonitor(id);
    return this.userProfile(monitor.username, id);
  }
  userProfile(username: string, id: string): AccountProfileView {
    const profile = this.dependencies.accounts.profileByUsername(username);
    const evidenceIds = [...new Set((profile?.evidenceIds ?? Object.values(profile?.memory ?? {}).flatMap(fact => fact.evidenceIds)).filter(id => !id.startsWith('bio:') && id !== 'manual'))];
    return { profile: profile ? { ...profile, memory: activeMemory(profile.memory) } : null,
      evidence: profile ? this.dependencies.accounts.posts(profile.account.id, evidenceIds) : [],
      status: this.dependencies.accounts.status(id) };
  }

  async editProfile(id: string, text: string): Promise<AccountProfileView> {
    const monitor = this.requireMonitor(id);
    return this.editUserProfile(monitor.username, id, text);
  }
  async editUserProfile(username: string, id: string, text: string): Promise<AccountProfileView> {
    return this.lock(username.toLowerCase(), async () => {
      const profile = this.dependencies.accounts.profileByUsername(username);
      if (!profile) throw new Error('暂无画像，请先点击更新画像');
      const lines = text.trim().split('\n');
      const memory: AccountMemory = {};
      const labels = ['背景', '主题', '用语', '近况'];
      let section: typeof SECTIONS[number] = 'background';
      for (const line of lines) {
        const labeled = labels.findIndex(label => line.startsWith(`${label}：`) || line.startsWith(`${label}:`));
        if (labeled >= 0) section = SECTIONS[labeled]!;
        const content = line.replace(/^(背景|主题|用语|近况)[:：]\s*/, '').trim();
        if (memory[section]) memory[section]!.text += `\n${content}`;
        else if (content) memory[section] = { text: content, evidenceIds: ['manual'], kind: 'manual', updatedAt: new Date().toISOString() };
      }
      const evidenceIds = profile.evidenceIds ?? [...new Set(Object.values(profile.memory).flatMap(fact => fact.evidenceIds))];
      this.dependencies.accounts.saveProfile({ ...profile, memory, portraitText: text.trim(), evidenceIds,
        version: profile.version + 1, updatedAt: new Date().toISOString() });
      return this.userProfile(username, id);
    });
  }

  /** Manual refresh rebuilds from current public sources without reusing memory or moving any rule's cursor. */
  async rebuildUserProfile(username: string, id: string, cookieId: string, ensureCurrent: () => void): Promise<AccountProfileView> {
    return this.lock(username.toLowerCase(), async () => {
      ensureCurrent();
      const { social, accounts } = this.dependencies;
      if (!social.fetchAccount) throw new Error('平台适配器不支持账号简介');
      // Explicit refresh bypasses the daily profile cache.
      const account = await social.fetchAccount(username, cookieId);
      if (!social.fetchTimelinePage) throw new Error('平台适配器不支持时间线分页');
      const page = await social.fetchTimelinePage(account, undefined, 'posts', cookieId);
      const input = portraitInput(account, page.posts);
      const result = await this.dependencies.matcher.analyze(input);
      ensureCurrent();
      const previous = accounts.profile(account.id);
      accounts.saveLearning({ account, memory: result.memory ?? {}, initialized: true, bioSource: bioSource(account),
        evidenceIds: input.posts.map(post => post.id),
        version: (previous?.version ?? 0) + 1, updatedAt: new Date().toISOString() }, input.posts);
      return this.userProfile(username, id);
    });
  }

  /** The workflow uses the same evidence, pagination, memory validation and per-user lock as the original listener. */
  async withWorkflowBatch<T>(workflow: Workflow, cookieId: string, preview: boolean,
    work: (batch: UserWorkflowBatch) => Promise<T>, commit: (cursor: string | null, postScan: Workflow['postScan']) => void = () => {}, report?: ReportAnalysisProgress,
    scan?: (postIds: string[]) => void, hasSeen: (postId: string) => boolean = () => false): Promise<T> {
    const username = workflow.usernames[0];
    if (workflow.source !== 'user' || workflow.usernames.length !== 1 || !username) throw new Error('每条监听只能指定一个用户');
    return this.lock(username.toLowerCase(), async () => {
      const accounts = this.dependencies.accounts;
      const status: MonitorBatchStatus = { fetched: 0, analyzed: 0, matched: 0, uncertain: 0, pending: 0, phase: 'fetch', error: null, checkedAt: new Date().toISOString() };
      try {
        const { account, profile } = await this.account(username, cookieId);
        const fetched = await this.fetchWorkflowWindow(account, !preview, cookieId, workflow);
        const window = fetched.posts;
        trace('timeline.window', '指定用户帖子读取完成', { username, count: window.length, posts: window });
        status.fetched = window.length;
        scan?.(window.map(post => post.id));
        const candidates = window.filter(post => {
          if (preview) return true;
          const reason = hasSeen(post.id) ? '已经处理' : workflow.lastSeenPostId && !after(post.id, workflow.lastSeenPostId) ? '已到达上次 Post 边界' : '';
          if (!reason) return true;
          trace('workflow.post.filtered', '帖子不参与本轮 AI 判断', { postId: post.id, author: post.author, reason });
          return false;
        });
        const rules = [{ id: workflow.id, prompt: workflow.condition, lastSeenPostId: null }];
        status.phase = 'analyze'; status.pending = candidates.length;
        const result = candidates.length
          ? await this.analyze(account, activeMemory(profile?.memory ?? {}), candidates, rules, true, false, this.support(profile), report)
          : { memory: activeMemory(profile?.memory ?? {}), decisions: [] };
        const { cursor, postScan } = fetched;
        const savedProfile: AccountProfile = { account, memory: result.memory, initialized: profile?.initialized ?? false,
          version: profile?.version ?? 0, updatedAt: profile?.updatedAt ?? '' };
        const batch: UserWorkflowBatch = { ...result, posts: candidates, profile: savedProfile, cursor, postScan,
          status: { ...status, analyzed: result.decisions.length, matched: result.decisions.filter(d => d.status === 'match').length,
            uncertain: result.decisions.filter(d => d.status === 'uncertain').length, pending: 0, phase: 'done', baselinePending: false } };
        const value = await work(batch);
        if (!preview) this.completeWorkflowBatch(workflow.id, batch, commit);
        return value;
      } catch (error) {
        if (!preview) accounts.saveStatus(workflow.id, { ...status, error: error instanceof Error ? error.message : String(error), baselinePending: false });
        throw error;
      }
    });
  }

  /** Retry commits the saved analysis without fetching or asking AI again. */
  completeWorkflowBatch(id: string, batch: UserWorkflowBatch,
    commit: (cursor: string | null, postScan: Workflow['postScan']) => void): void {
    const accounts = this.dependencies.accounts;
    accounts.transaction(() => {
      commit(batch.cursor, batch.postScan);
      accounts.saveDecisions(id, batch.decisions);
      accounts.saveStatus(id, batch.status);
    });
    trace('workflow.analysis.saved', '监听判断与处理记录已保存', { latestPostId: batch.cursor, postScan: batch.postScan, analyzed: batch.decisions.length });
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
      const window = await this.fetchWindow(account, boundary, rules.some(rule => newRules.has(rule.id)) ? 20 : 0, true);
      status.fetched = window.length;
      const baseline = window.at(-1)?.id ?? null;
      // A legacy rule first records its snapshot; migrated rules retain their existing boundary.
      const activeRules = rules.filter(rule => !newRules.has(rule.id));
      const fresh = window.filter(post => activeRules.some(rule => after(post.id, rule.lastSeenPostId)));
      candidates = fresh;
      status.pending = fresh.length;
      status.phase = 'analyze';
      const result = candidates.length
        ? await this.analyze(account, activeMemory(profile?.memory ?? {}), candidates, activeRules, true, true, this.support(profile))
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

  private async account(username: string, cookieId?: string): Promise<{ account: SocialAccount; profile: AccountProfile | null }> {
    const profile = this.dependencies.accounts.profileByUsername(username);
    if (profile && Date.now() - Date.parse(profile.account.fetchedAt) < 86400000) return { account: profile.account, profile };
    if (!this.dependencies.social.fetchAccount) throw new Error('平台适配器不支持账号简介');
    const account = await this.dependencies.social.fetchAccount(username, cookieId);
    return { account, profile: this.dependencies.accounts.profile(account.id) };
  }

  /** Read only Post pages; a completed scan advances its Post-only checkpoint. */
  private async fetchWorkflowWindow(account: SocialAccount, persist: boolean, cookieId: string, workflow: Workflow): Promise<{
    posts: SocialPost[]; cursor: string | null; postScan: Workflow['postScan'];
  }> {
    const { social, accounts } = this.dependencies;
    if (!social.fetchTimelinePage) throw new Error('平台适配器不支持时间线分页');
    const boundary = persist ? workflow.lastSeenPostId ?? null : null;
    const continuation = persist && workflow.postScan?.accountId === cookieId ? workflow.postScan : null;
    let cursor: string | undefined = continuation?.cursor;
    let newestPostId = continuation?.newestPostId ?? boundary;
    const cursors = new Set(cursor ? [cursor] : []);
    const posts = new Map<string, SocialPost>();
    let pages = 0;
    let reason: 'boundary_reached' | 'no_next_page' | 'page_limit' = 'page_limit';
    while (pages < MAX_WORKFLOW_TIMELINE_PAGES) {
      pages++;
      trace('timeline.page.start', '读取用户 Post 分页', { username: account.username, surface: 'posts', page: pages,
        maxPages: MAX_WORKFLOW_TIMELINE_PAGES, cursor, boundary, continuing: Boolean(continuation) });
      const page = await social.fetchTimelinePage(account, cursor, 'posts', cookieId);
      const pagePosts = page.posts.filter(post => post.type !== 'reply');
      // The X parser supplies only chronological top-level originals as anchors.
      // Adapter fixtures without metadata treat their original posts as anchors.
      const anchors = page.boundaryPostIds ?? pagePosts.filter(post => post.type === 'post').map(post => post.id);
      for (const id of anchors) if (after(id, newestPostId)) newestPostId = id;
      const reached = Boolean(boundary && anchors.some(id => !after(id, boundary)));
      trace('timeline.page.done', '用户 Post 分页已获取', { username: account.username, surface: 'posts', page: pages,
        count: pagePosts.length, excludedReplies: page.posts.length - pagePosts.length, nextCursor: page.nextCursor,
        boundary, boundaryReached: reached, posts: pagePosts });
      if (persist) accounts.savePosts(account.id, pagePosts);
      // Inspect the whole page, even when its first item has crossed the boundary.
      for (const post of pagePosts) posts.set(post.id, post);
      if (reached) { reason = 'boundary_reached'; cursor = undefined; break; }
      if (!page.nextCursor) { reason = 'no_next_page'; cursor = undefined; break; }
      if (cursors.has(page.nextCursor)) throw new Error('X 分页游标重复，本轮未提交处理进度');
      cursors.add(page.nextCursor); cursor = page.nextCursor;
    }
    // Initial history is bounded to five pages. Later catch-up windows must retain
    // their old boundary and continuation so a capped scan never skips a gap.
    const postScan = reason === 'page_limit' && boundary && cursor
      ? { cursor, newestPostId, accountId: cookieId } : null;
    const committed = postScan ? boundary : newestPostId;
    const messages = { boundary_reached: '已到达上次 Post 边界，停止翻页', no_next_page: '用户 Post 已无下一页', page_limit: '已达到本轮 5 批 Post 抓取上限' };
    trace('timeline.fetch.finished', messages[reason], { surface: 'posts', pages, maxPages: MAX_WORKFLOW_TIMELINE_PAGES,
      count: posts.size, boundary, latestPostId: newestPostId, nextBoundary: committed, nextCursor: postScan?.cursor ?? null, reason });
    return { posts: uniquePosts([...posts.values()]), cursor: committed, postScan };
  }

  private async fetchWindow(account: SocialAccount, boundary: string | null, minimum: number, persist: boolean, cookieId?: string): Promise<SocialPost[]> {
    const combined = uniquePosts(await this.fetchStream(account, boundary, minimum, persist, 'posts', cookieId));
    return boundary || !minimum ? combined : combined.slice(-minimum);
  }

  private async fetchStream(account: SocialAccount, boundary: string | null, minimum: number, persist: boolean, surface: 'posts' | 'replies', cookieId?: string): Promise<SocialPost[]> {
    const { social, accounts } = this.dependencies;
    if (!social.fetchTimelinePage) throw new Error('平台适配器不支持时间线分页');
    const posts = new Map<string, SocialPost>();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    for (let pageNumber = 0; pageNumber < 50; pageNumber += 1) {
      trace('timeline.page.start', '读取用户时间线分页', { username: account.username, surface, page: pageNumber + 1, cursor, boundary });
      const raw = await social.fetchTimelinePage(account, cursor, surface, cookieId);
      const page = { ...raw, posts: raw.posts.filter(post => post.type !== 'reply') };
      trace('timeline.page.done', '用户时间线分页已获取', { username: account.username, surface, page: pageNumber + 1, count: page.posts.length, nextCursor: page.nextCursor, posts: page.posts });
      if (persist) accounts.savePosts(account.id, page.posts);
      for (const post of page.posts) posts.set(post.id, post);
      const ordered = uniquePosts([...posts.values()]);
      const covered = boundary ? page.posts.length > 0 && page.posts.every(post => !after(post.id, boundary)) : minimum > 0 && ordered.length >= minimum;
      // An empty filtered page can still have a continuation (e.g. conversation context or unavailable posts).
      if (!page.nextCursor || (covered && ordered.length >= minimum)) {
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

  private async analyze(account: SocialAccount, initial: AccountMemory, posts: SocialPost[], rules: Pick<Monitor, 'id' | 'prompt' | 'lastSeenPostId'>[], includeBio: boolean, excludeBaselines: boolean, support: SocialPost[] = [], report?: ReportAnalysisProgress): Promise<{ memory: AccountMemory; decisions: PostDecision[] }> {
    const memory = initial;
    if (!posts.length || !rules.length) return { memory, decisions: [] };
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
      const progress = { index: batchCount + 1, phase: rules.length ? 'analyze' as const : 'learn' as const, postIds: batch.map(post => post.id) };
      report?.(progress);
      const result = await this.dependencies.matcher.analyze(input(batch));
      batchCount += 1;
      decisions.push(...result.decisions);
      report?.({ ...progress, decisions: result.decisions.map(d => ({ postId: d.postId, matched: d.status === 'match' })) });
      offset += batch.length;
      context = batch.slice(-2);
    } while (offset < posts.length);
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
