import { randomUUID } from "node:crypto";
import {
  renderPrompt,
  RANDOM_WORKFLOW_ACCOUNT,
  type SocialPost,
  type Workflow,
  type WorkflowPreview,
  type WorkflowRecord,
  type WorkflowAction,
  type WorkflowRun,
  type AccountProfile,
  type AccountProfileView,
} from "@fast-social/contracts";
import type { WorkflowRepository } from "./repository.ts";
import type { SettingsRepository } from "../repositories/settings-repository.ts";
import type { OutreachAdapter, OutreachPost } from "../outreach/types.ts";
import type { MonitorRunner, UserWorkflowBatch } from '../monitor/monitor-runner.ts';
import type { WorkflowDecision } from './matcher.ts';
import { AccountRequestLimitError } from '../configuration/request-limits.ts';
import { WorkflowProgress, type ReportAnalysisProgress } from './progress.ts';
import { withXRequestGuard, withQueuedXRequests } from '../adapters/x/request-queue.ts';
import { trace, withTrace, setTraceFields, errorDetails, type ExecutionLogger } from '../observability/trace.ts';

interface Dependencies {
  logger?: ExecutionLogger;
  deferPortraits?: (work: () => Promise<void>) => Promise<void>;
  repository: WorkflowRepository;
  settings: SettingsRepository;
  x: OutreachAdapter;
  timeline: (username: string, accountId: string) => Promise<SocialPost[]>;
  userId: (username: string, accountId: string) => Promise<string>;
  evaluateBatch: (
    condition: string,
    posts: SocialPost[],
    ensureCurrent?: () => void,
    report?: ReportAnalysisProgress,
  ) => Promise<WorkflowDecision[]>;
  generate: (prompt: string) => Promise<string>;
  generateReply?: (accountId: string, post: SocialPost, action: Extract<WorkflowAction, { mode: "skill" }>, targetProfile?: AccountProfile) => Promise<string>;
  notify: (content: string, post: SocialPost) => Promise<void>;
  random?: () => number;
  userListener?: Pick<MonitorRunner, 'withWorkflowBatch' | 'userProfile' | 'editUserProfile' | 'rebuildUserProfile'>;
}
class RunCancelled extends Error {
  constructor() {
    super("编排已修改、删除或服务正在停止，本次执行已结束");
  }
}
class FollowSkipped extends Error {}
export class WorkflowService {
  private deps: Dependencies;
  private timer: ReturnType<typeof setInterval> | undefined;
  private active = new Map<string, Promise<void>>();
  private profileUpdates = new Map<string, Promise<AccountProfileView>>();
  private latestRuns = new Map<string, WorkflowRun>();
  private stopping = false;
  constructor(deps: Dependencies) {
    this.deps = deps;
    deps.repository.recover();
  }
  start(): void {
    this.timer = setInterval(() => {
      void this.tick();
    }, 15_000);
    this.timer.unref();
    void this.tick();
  }
  async stop(): Promise<void> {
    this.stopping = true;
    clearInterval(this.timer);
    await Promise.allSettled([...this.active.values(), ...this.profileUpdates.values()]);
  }
  private selectAccount(w: Workflow, readOnly = false) {
    if (w.accountId === RANDOM_WORKFLOW_ACCOUNT && w.source === 'home') throw new Error('账号首页监听需要指定账号');
    const cookies = this.deps.settings.configuration.cookies();
    const needsIdentity = !readOnly && (w.source === 'home' || w.actions.some(a => a.type === 'follow' || a.type === 'reply'));
    const accounts = this.deps.settings.configuration.accounts().filter(a => a.cookieConfigured && a.status !== 'invalid'
      && cookies.some(c => c.id === a.id && c.enabled) && (!needsIdentity || !!a.actorId));
    const account = w.accountId === RANDOM_WORKFLOW_ACCOUNT
      ? accounts[Math.min(accounts.length - 1, Math.floor((this.deps.random?.() ?? Math.random()) * accounts.length))]
      : accounts.find(a => a.id === w.accountId);
    if (!account) throw new Error('没有可用的执行账号，请检查账号 Cookie；关注和回复需要 Cookie 包含 twid');
    return account;
  }
  private async fetch(w: Workflow, accountId: string): Promise<OutreachPost[]> {
    if (w.source === "home")
      return this.deps.x.home(this.deps.x.identity(accountId), []);
    const posts: OutreachPost[] = [];
    for (const username of w.usernames) {
      for (const post of await this.deps.timeline(username, accountId))
        posts.push({
          post,
          userId: "",
          name: post.author,
          following: null,
          followedBy: null,
        });
    }
    return [...new Map(posts.map((p) => [p.post.id, p])).values()]
      .sort((a, b) => a.post.createdAt.localeCompare(b.post.createdAt))
      .slice(-40);
  }
  async preview(w: Workflow): Promise<WorkflowPreview[]> {
    const account = this.selectAccount(w);
    if (w.source === 'user' && this.deps.userListener) {
      return this.deps.userListener.withWorkflowBatch(w, account.id, true, async batch => batch.decisions.map(d => ({
        post: batch.posts.find(p => p.id === d.postId)!, matched: d.status === 'match', reason: d.reason,
      })));
    }
    const posts = [...new Map((await this.fetch(w, account.id)).map(item => [item.post.id, item.post])).values()];
    const decisions = posts.length ? await this.deps.evaluateBatch(w.condition, posts) : [];
    return decisions.map(result => ({ post: posts.find(post => post.id === result.postId)!, matched: result.matched, reason: result.message }));
  }
  profile(id: string) {
    const w = this.deps.repository.get(id);
    if (!w || w.source !== 'user' || !this.deps.userListener) throw new Error('请选择指定用户监听');
    return this.deps.userListener.userProfile(w.usernames[0]!, id);
  }
  editProfile(id: string, text: string) {
    const w = this.deps.repository.get(id);
    if (!w || w.source !== 'user' || !this.deps.userListener) throw new Error('请选择指定用户监听');
    return this.deps.userListener.editUserProfile(w.usernames[0]!, id, text);
  }
  rebuildProfile(id: string): Promise<AccountProfileView> {
    if (this.stopping) throw new Error('服务正在停止，请稍后重试');
    const previous = this.profileUpdates.get(id);
    if (previous) return previous;
    const w = this.deps.repository.get(id);
    if (!w || w.source !== 'user' || w.usernames.length !== 1 || !this.deps.userListener) throw new Error('请选择指定用户监听');
    const account = this.selectAccount(w, true);
    const ensureCurrent = () => {
      const current = this.deps.repository.get(id);
      if (this.stopping || !current || current.source !== 'user' || current.usernames[0] !== w.usernames[0])
        throw new Error('监听用户已修改、任务已删除或服务正在停止，画像未更新');
    };
    const pending = withXRequestGuard(ensureCurrent, () => this.deps.userListener!.rebuildUserProfile(w.usernames[0]!, id, account.id, ensureCurrent))
      .finally(() => { this.profileUpdates.delete(id); });
    this.profileUpdates.set(id, pending);
    return pending;
  }
  async tick(): Promise<void> {
    if (this.stopping) return;
    for (const w of this.deps.repository.list()) {
      if (
        w.enabled &&
        !this.active.has(w.id) &&
        (!w.retryAt || Date.now() >= Date.parse(w.retryAt)) &&
        (!w.lastCheckedAt ||
          Date.now() - Date.parse(w.lastCheckedAt) >=
            w.intervalMinutes * 60_000)
      ) {
        await this.run(w.id);
      }
    }
  }
  runs(): WorkflowRun[] {
    return this.deps.repository.list().flatMap(w => {
      const run = this.latestRuns.get(w.id);
      return run ? [{ ...run, batch: run.batch ? { ...run.batch } : undefined }] : [];
    });
  }
  runOnce(id: string): WorkflowRun | null {
    if (this.stopping || !this.deps.repository.get(id)) return null;
    void this.run(id, true);
    return { ...this.latestRuns.get(id)! };
  }
  run(id: string, manual = false): Promise<void> {
    if (this.stopping) return Promise.resolve();
    const previous = this.active.get(id);
    if (previous) return previous;
    const w = this.deps.repository.get(id);
    if (!w || (!manual && !w.enabled)) return Promise.resolve();
    const run: WorkflowRun = {
      id: randomUUID(), workflowId: id, status: "running", phase: 'fetch',
      scanned: 0, aiMatched: 0, checked: 0, matched: 0, completed: 0, error: null,
      startedAt: new Date().toISOString(), finishedAt: null,
    };
    this.latestRuns.set(id, run);
    // Claim the workflow before starting asynchronous work; manual and scheduled runs share this lock.
    const execute = async () => {
      trace('workflow.start', '监听执行开始', { manual, source: w.source, usernames: w.usernames, condition: w.condition, actions: w.actions });
      try { await withQueuedXRequests(() => withXRequestGuard(() => this.ensureCurrent(w), () => this.execute(w, run))); }
      catch (error) {
        run.status = 'failed'; run.error = error instanceof Error ? error.message : String(error);
        trace('workflow.error', '监听执行异常', { error: errorDetails(error) });
      } finally {
        run.finishedAt = new Date().toISOString();
        trace('workflow.finish', '监听整体运行结果', { ...run, durationMs: Date.parse(run.finishedAt) - Date.parse(run.startedAt) });
      }
    };
    const fields = { traceId: run.id, runId: run.id, workflowId: w.id, workflowName: w.name };
    const work = () => this.deps.deferPortraits ? this.deps.deferPortraits(execute) : execute();
    const promise = Promise.resolve().then(() => this.deps.logger ? this.deps.logger.run(fields, work) : withTrace(fields, work))
      .finally(() => { this.active.delete(id); });
    this.active.set(id, promise);
    return promise;
  }
  private current(w: Workflow): boolean {
    const now = this.deps.repository.get(w.id);
    return (
      !this.stopping &&
      !!now &&
      now.enabled === w.enabled &&
      now.accountId === w.accountId &&
      JSON.stringify(now.actions) === JSON.stringify(w.actions) &&
      now.condition === w.condition &&
      now.source === w.source &&
      JSON.stringify(now.usernames) === JSON.stringify(w.usernames)
    );
  }
  private ensureCurrent(w: Workflow): void {
    if (!this.current(w)) throw new RunCancelled();
  }
  private async execute(w: Workflow, run: WorkflowRun): Promise<void> {
    const { repository: repo } = this.deps, id = w.id;
    const requiresFollow = w.actions.some(action => action.type === 'follow');
    const progress = new WorkflowProgress(run, requiresFollow);
    let analysisReported = false;
    const report: ReportAnalysisProgress = update => {
      this.ensureCurrent(w);
      analysisReported = true;
      progress.report(update);
      trace(update.decisions ? 'workflow.ai.result' : 'workflow.ai.start', update.decisions ? 'AI 批次判断完成' : '开始 AI 批次判断',
        { ...update, scanned: run.scanned, aiMatched: run.aiMatched, completed: run.completed });
    };
    let record: WorkflowRecord | undefined;
    try {
      this.ensureCurrent(w);
      if (!w.actions.length) throw new Error('请先添加执行动作');
      const signature = JSON.stringify([w.accountId, w.source, w.usernames, w.condition, w.actions]);
      const waiting = repo.pending(id);
      for (const entry of waiting) if (entry.resume?.configuration !== signature) {
        entry.status = 'failed';
        for (const step of entry.actions) if (step.status === 'pending') { step.status = 'failed'; step.result = '编排已修改，原待执行动作已取消'; }
        delete entry.resume; repo.record(entry);
      }
      const pending = waiting.find(entry => entry.status === 'pending');
      const account = this.selectAccount(pending?.accountId ? { ...w, accountId: pending.accountId } : w);
      run.accountId = account.id; run.accountName = account.name;
      setTraceFields({ accountId: account.id, accountName: account.name, actorId: account.actorId });
      trace('workflow.account', '已选定执行账号');
      const identity = w.actions.some(
        (a) => a.type === "follow" || a.type === "reply"
      )
        ? this.deps.x.identity(account.id)
        : null;
      const followedAuthors = new Set<string>();
      const followSkipReason = (item: OutreachPost, continuingNewFollow = false): string | null => {
        if (!requiresFollow) return null;
        if (item.userId && item.userId === identity!.actorId) return '跳过当前账号';
        const tracked = this.deps.x.followSkipReason?.(identity!, item.userId, item.post.author, continuingNewFollow);
        if (tracked) return tracked;
        if (!continuingNewFollow && (item.following || followedAuthors.has(item.userId || item.post.author.toLowerCase())))
          return '已经关注，跳过后续动作';
        return null;
      };
      const act = async (item: OutreachPost, result: { message: string }, profile?: AccountProfile, existing?: WorkflowRecord) => withTrace({ postId: item.post.id, author: item.post.author }, async () => {
        const post = item.post;
        progress.actions(post.id);
        record = existing ?? {
          id: randomUUID(),
          workflowId: id,
          accountId: account.id,
          accountName: account.name,
          post,
          reason: result.message,
          status: "running",
          actions: w.actions.map((a) => ({ type: a.type, status: "pending" })),
          createdAt: new Date().toISOString(),
          resume: { configuration: signature, userId: item.userId, following: item.following },
        };
        record.status = "running";
        // Persist a claim before any external side effect. An ambiguous failure is never retried automatically.
        repo.markSeen(id, post.id);
        repo.record(record);
        const currentRecord = record;
        setTraceFields({ recordId: record.id });
        trace('workflow.post.start', '开始处理命中帖子', { post, reason: result.message, resumed: !!existing });
        let newlyFollowed = record.actions.some(step => step.type === 'follow' && step.status === 'done' && step.newlyFollowed === true);
        const ensureEligible = (beforeReply = false) => {
          const reason = followSkipReason(item, newlyFollowed);
          if (reason) throw new FollowSkipped(reason);
          if (requiresFollow && beforeReply && !newlyFollowed)
            throw new FollowSkipped('没有本次新关注成功的记录，跳过回复');
        };
        try {
          ensureEligible();
          if (requiresFollow && record.actions.some(step => step.type === 'follow' && step.status === 'done' && step.newlyFollowed !== true))
            throw new FollowSkipped('原记录未确认本次新关注，跳过后续动作');
          if (newlyFollowed) progress.followed(post.id);
          for (let i = 0; i < w.actions.length; i++) {
            this.ensureCurrent(w);
            ensureEligible();
            const action = w.actions[i]!,
              step = record.actions[i]!;
            if (step.status === "done") { trace('workflow.action.resumed', '动作此前已完成，不重复执行', { action: action.type, result: step.result }); continue; }
            let replyText = "";
            if (action.type === "reply") {
              ensureEligible(true);
              trace('workflow.reply.prepare', '准备回复内容', { mode: action.mode, action });
              if (action.mode === "text") replyText = action.text;
              else if (action.mode === "skill") {
                if (!this.deps.generateReply) throw new Error("回复 Skill 不可用");
                replyText = await withTrace({ aiOperation: 'AI 生成回复' }, () => this.deps.generateReply!(account.id, post, action, profile));
              }
              else {
                const prompt = this.deps.settings
                  .getInteractionPrompts()
                  .find((p) => p.id === action.promptId);
                if (!prompt) throw new Error("回复模板已删除");
                const elements = renderPrompt(prompt.prompt, {
                    input: action.input,
                    reply: post.text,
                    targetLanguage: this.deps.settings.configuration.profile(account.id).primaryLanguage,
                  });
                if (!this.deps.generateReply) throw new Error('回复 Skill 不可用');
                replyText = await withTrace({ aiOperation: 'AI 生成回复' }, () => this.deps.generateReply!(account.id, post, { type: 'reply', mode: 'skill', elements }, profile));
              }
              if (!replyText.trim()) throw new Error("回复内容为空");
              trace('workflow.reply.ready', '回复内容已准备', { text: replyText });
            }
            this.ensureCurrent(w);
            if (action.type === "follow" && !item.userId) {
              item.userId = await this.deps.userId(post.author, account.id);
              record.resume!.userId = item.userId;
            }
            this.ensureCurrent(w);
            ensureEligible(action.type === 'reply');
            step.status = "running";
            repo.record(record);
            trace('workflow.action.start', `开始${({ follow: '关注作者', reply: '回复 Post', notify: '发送通知' })[action.type]}`,
              { action: action.type, userId: item.userId, ...(action.type === 'reply' ? { text: replyText } : {}) });
            if (action.type === "follow") {
              const result = await this.deps.x.follow(identity!, item.userId, post.author);
              if (result.created === false) throw new FollowSkipped(result.skipReason ?? '未建立新的关注关系，跳过后续动作');
              if (!result.following)
                throw new Error("X 未确认关注成功，已停止后续动作");
              step.result = "已关注";
              step.newlyFollowed = true;
              newlyFollowed = true;
              followedAuthors.add(item.userId || post.author.toLowerCase());
              progress.followed(post.id);
            } else if (action.type === "reply")
              step.result = await withXRequestGuard(() => ensureEligible(true), () => this.deps.x.reply(
                identity!,
                post.id,
                replyText
              ));
            else {
              await this.deps.notify(
                [action.content, result.message, post.text]
                  .filter(Boolean)
                  .join("\n\n"),
                post
              );
              step.result = "已通知";
            }
            step.status = "done";
            trace('workflow.action.done', '动作执行成功', { action: action.type, result: step.result, newlyFollowed: step.newlyFollowed });
            if (repo.get(id)) repo.record(record);
            this.ensureCurrent(w);
          }
          record.status = "done";
          delete record.resume;
          repo.record(record);
          progress.complete(post.id);
          trace('workflow.post.done', '帖子处理完成', { completed: run.completed });
          record = undefined;
        } catch (error) {
          if (!(error instanceof FollowSkipped)) throw error;
          currentRecord.status = 'skipped';
          trace('workflow.post.skipped', '跳过后续动作', { reason: error.message });
          for (const step of currentRecord.actions) if (step.status === 'pending' || step.status === 'running') {
            step.status = 'skipped'; step.result = error.message;
          }
          delete currentRecord.resume;
          repo.record(currentRecord);
          record = undefined;
        }
      });
      if (pending) {
        this.ensureCurrent(w);
        report({ index: 0, phase: 'analyze', postIds: [pending.post.id], decisions: [{ postId: pending.post.id, matched: true }] });
        await act({ post: pending.post, userId: pending.resume!.userId, name: pending.post.author,
          following: pending.resume!.following, followedBy: null }, { message: pending.reason }, undefined, pending);
      }
      analysisReported = false;
      run.phase = 'fetch'; run.batch = undefined;
      trace('workflow.fetch.start', w.source === 'home' ? '开始获取账号首页 Post' : '开始获取指定用户 Post', { source: w.source, usernames: w.usernames });
      const process = async (batch?: UserWorkflowBatch) => {
        const fetched = batch ? batch.posts.map(post => ({ post, userId: '', name: post.author, following: null, followedBy: null })) : await this.fetch(w, account.id);
        const posts = [...new Map(fetched.map(item => [item.post.id, item])).values()];
        trace('workflow.fetch.done', '本轮帖子已获取', { count: posts.length, posts });
        this.ensureCurrent(w);
        progress.scan(posts.map(item => item.post.id));
        const candidates = batch ? [] : posts.filter(item => {
          if (repo.seen(id, item.post.id)) {
            trace('workflow.post.filtered', '帖子不参与本轮 AI 判断', { postId: item.post.id, author: item.post.author, reason: '已经处理' });
            return false;
          }
          const reason = followSkipReason(item);
          if (reason) { trace('workflow.post.filtered', '帖子不参与本轮 AI 判断', { postId: item.post.id, author: item.post.author, reason }); repo.markSeen(id, item.post.id); return false; }
          return true;
        });
        if (!batch && candidates.length) run.phase = 'analyze';
        const decisions: WorkflowDecision[] = batch
          ? batch.decisions.map(d => ({ postId: d.postId, matched: d.status === 'match', message: d.reason }))
          : candidates.length ? await this.deps.evaluateBatch(w.condition, candidates.map(item => item.post), () => this.ensureCurrent(w), report) : [];
        this.ensureCurrent(w);
        const byPost = new Map(decisions.map(d => [d.postId, d]));
        if (!batch && (decisions.length !== candidates.length || byPost.size !== candidates.length || candidates.some(item => !byPost.has(item.post.id))))
          throw new Error('AI 批量判断结果与帖子不一致，监听进度保持不变');
        if (!analysisReported && decisions.length)
          report({ index: 1, phase: 'analyze', postIds: decisions.map(d => d.postId), decisions });
        trace('workflow.decisions', '完整 AI 判断结果', { count: decisions.length, decisions });
        for (const item of posts) {
          this.ensureCurrent(w);
          const post = item.post;
          if (repo.seen(id, post.id)) continue;
          const result = byPost.get(post.id);
          if (!result) continue;
          if (!result.matched) {
            repo.markSeen(id, post.id);
            continue;
          }
          await act(item, result, batch?.profile);
        }
      };
      if (w.source === 'user' && this.deps.userListener) {
        await this.deps.userListener.withWorkflowBatch(w, account.id, false, process, (cursor, postScan) => {
          this.ensureCurrent(w);
          repo.write({ ...repo.get(id)!, lastSeenPostId: cursor, postScan });
        }, report, progress.scan, postId => repo.seen(id, postId));
      } else await process();
      const current = repo.get(id);
      if (current)
        repo.write({
          ...current,
          lastCheckedAt: new Date().toISOString(),
          lastError: null,
          retryAt: null,
        });
      run.status = "done";
    } catch (error) {
      const limited = error instanceof AccountRequestLimitError;
      const active = record?.actions.find((a) => a.status === "running");
      const cause = error instanceof Error ? error.message : String(error);
      const message = record && active && !limited && !(error instanceof RunCancelled)
        ? `${({ follow: '关注', reply: '回复', notify: '通知' })[active.type]} @${record.post.author.replace(/^@/, '')}（Post ${record.post.id}）失败：${cause}；已暂停后续动作，不会自动重发`
        : cause;
      run.status = limited ? "limited" : error instanceof RunCancelled ? "cancelled" : "failed";
      run.error = message;
      trace('workflow.error', '监听执行未完成', { status: run.status, recordId: record?.id, postId: record?.post.id, action: active?.type,
        error: errorDetails(error), message, scanned: run.scanned, aiMatched: run.aiMatched, completed: run.completed });
      if (record) {
        record.status = limited ? "pending" : active ? "uncertain" : "failed";
        if (limited) {
          const blocked = active ?? record.actions.find(a => a.status === 'pending');
          if (blocked) { blocked.status = 'pending'; blocked.result = message; }
        } else if (active) {
          active.status = "uncertain";
          active.result = message;
        } else {
          const pending = record.actions.find((a) => a.status === "pending");
          if (pending) {
            pending.status = "failed";
            pending.result = message;
          }
        }
        if (repo.get(id)) repo.record(record);
      }
      const current = repo.get(id);
      if (current && !(error instanceof RunCancelled))
        repo.write({
          ...current,
          enabled: record && !limited ? false : current.enabled,
          retryAt: limited ? error.resetsAt : null,
          lastCheckedAt: new Date().toISOString(),
          lastError: message,
        });
    }
  }
}
