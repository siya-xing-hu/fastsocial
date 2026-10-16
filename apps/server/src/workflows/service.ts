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
  workflowConfiguration,
  type WorkflowRetryPlan,
  type WorkflowRetryInput,
} from "@fast-social/contracts";
import type { WorkflowCheckpoint } from './checkpoint.ts';
import type { WorkflowRepository } from "./repository.ts";
import type { SettingsRepository } from "../repositories/settings-repository.ts";
import type { OutreachAdapter, OutreachPost } from "../outreach/types.ts";
import type { MonitorRunner, UserWorkflowBatch } from '../monitor/monitor-runner.ts';
import type { WorkflowDecision } from './matcher.ts';
import { AccountRequestLimitError } from '../configuration/request-limits.ts';
import { WorkflowProgress, type ReportAnalysisProgress } from './progress.ts';
import { withXRequestGuard, withQueuedXRequests } from '../adapters/x/request-queue.ts';
import { trace, withTrace, setTraceFields, errorDetails, type ExecutionLogger } from '../observability/trace.ts';
import { ValidationError } from '../http/validation.ts';

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
  userListener?: Pick<MonitorRunner, 'withWorkflowBatch' | 'completeWorkflowBatch' | 'userProfile' | 'editUserProfile' | 'rebuildUserProfile'>;
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
    for (const w of deps.repository.list()) {
      const checkpoint = deps.repository.checkpoint(w.id);
      if (checkpoint) this.latestRuns.set(w.id, checkpoint.run);
    }
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
  retryPlan(id: string): WorkflowRetryPlan {
    const w = this.deps.repository.get(id);
    if (!w) throw new ValidationError('编排不存在');
    const configuration = workflowConfiguration(w);
    const checkpoint = this.deps.repository.checkpoint(id);
    if (checkpoint && checkpoint.run.status !== 'done' && checkpoint.configuration !== configuration)
      throw new ValidationError('失败后编排已修改，不能按当前配置恢复原轮次');
    const round = checkpoint?.configuration === configuration && checkpoint.run.status !== 'done' ? checkpoint : undefined;
    const unresolved = round ? this.deps.repository.checkpointRecords(round).filter(r => r.status !== 'done' && r.status !== 'skipped')
      : this.deps.repository.retryable(id);
    const records = unresolved.filter(entry => entry.resume?.configuration === configuration);
    if (round && records.length !== unresolved.length)
      throw new ValidationError('本轮未完成记录的恢复信息不完整，请核对执行记录');
    if (unresolved.some(entry => entry.resume?.configuration !== configuration && w.lastError
      && entry.actions.some(step => step.result === w.lastError)))
      throw new ValidationError('失败后编排已修改或原记录缺少恢复信息，不能按当前配置重发旧动作，请核对执行记录');
    if (!round && !records.length && !w.lastError) throw new ValidationError('当前没有需要重试的失败');
    return { configuration, records, analysisComplete: round?.analysisComplete ?? records.length > 0,
      run: round?.run, revision: round?.revision, restoreEnabled: w.resumeEnabledAfterFailure ?? (!w.enabled && records.length > 0) };
  }
  retryOnce(id: string, input: WorkflowRetryInput): WorkflowRun | null {
    if (this.stopping) return null;
    if (this.active.has(id)) return { ...this.latestRuns.get(id)! };
    const plan = this.retryPlan(id);
    if (plan.run?.id !== input.runId || plan.revision !== input.revision
      || plan.configuration !== input.configuration || plan.restoreEnabled !== input.restoreEnabled
      || JSON.stringify(plan.records.map(r => r.id)) !== JSON.stringify(input.recordIds))
      throw new ValidationError('编排或失败记录已变化，请重新确认重试');
    if (!input.confirmUncertain && plan.records.some(r => r.actions.some(a => a.status === 'uncertain' && a.type !== 'follow')))
      throw new ValidationError('请先核对结果不确定的回复或通知，确认未发送后再手动重试');
    void this.run(id, true, plan);
    return { ...this.latestRuns.get(id)! };
  }
  run(id: string, manual = false, retry?: WorkflowRetryPlan): Promise<void> {
    if (this.stopping) return Promise.resolve();
    const previous = this.active.get(id);
    if (previous) return previous;
    const w = this.deps.repository.get(id);
    if (!w || (!manual && !w.enabled)) return Promise.resolve();
    const saved = this.deps.repository.checkpoint(id);
    const resume = saved?.configuration === workflowConfiguration(w) && saved.run.status !== 'done' ? saved : undefined;
    // A normal run must not bypass confirmation or replace an unfinished action queue.
    if (resume?.analysisComplete && resume.run.status !== 'limited' && !retry) {
      this.latestRuns.set(id, resume.run);
      return Promise.resolve();
    }
    const run: WorkflowRun = resume ? { ...resume.run, status: 'running', error: null, finishedAt: null } : {
      id: randomUUID(), workflowId: id, status: 'running', phase: 'fetch',
      scanned: 0, aiMatched: 0, checked: 0, matched: 0, completed: 0, error: null,
      startedAt: new Date().toISOString(), finishedAt: null,
    };
    const checkpoint: WorkflowCheckpoint = resume ? { ...resume, run } : {
      configuration: workflowConfiguration(w), revision: 0, run, analysisComplete: false, recordIds: [],
    };
    this.deps.repository.saveCheckpoint(checkpoint);
    this.latestRuns.set(id, run);
    // Claim the workflow before starting asynchronous work; manual and scheduled runs share this lock.
    const execute = async () => {
      trace('workflow.start', retry ? '监听手动重试开始' : '监听执行开始', { manual, retryRecordIds: retry?.records.map(r => r.id), source: w.source, usernames: w.usernames, condition: w.condition, actions: w.actions });
      try { await withQueuedXRequests(() => withXRequestGuard(() => this.ensureCurrent(w), () => this.execute(w, run, checkpoint, retry))); }
      catch (error) {
        run.status = 'failed'; run.error = error instanceof Error ? error.message : String(error);
        trace('workflow.error', '监听执行异常', { error: errorDetails(error) });
      } finally {
        run.finishedAt = new Date().toISOString();
        if (this.deps.repository.get(id)) this.deps.repository.saveCheckpoint(checkpoint);
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
  private async execute(w: Workflow, run: WorkflowRun, checkpoint: WorkflowCheckpoint, retry?: WorkflowRetryPlan): Promise<void> {
    const { repository: repo } = this.deps, id = w.id;
    const requiresFollow = w.actions.some(action => action.type === 'follow');
    const progress = new WorkflowProgress(run, requiresFollow, checkpoint.analysisComplete ? checkpoint.progress : undefined);
    const persist = (records: WorkflowRecord[] = [], seen: string[] = []) => {
      checkpoint.progress = progress.snapshot();
      if (repo.get(id)) repo.saveCheckpoint(checkpoint, records, seen);
    };
    if (!checkpoint.analysisComplete) run.phase = 'fetch';
    let analysisReported = false;
    const report: ReportAnalysisProgress = update => {
      this.ensureCurrent(w);
      analysisReported = true;
      progress.report(update);
      persist();
      trace(update.decisions ? 'workflow.ai.result' : 'workflow.ai.start', update.decisions ? 'AI 批次判断完成' : '开始 AI 批次判断',
        { ...update, scanned: run.scanned, aiMatched: run.aiMatched, completed: run.completed });
    };
    let record: WorkflowRecord | undefined;
    try {
      this.ensureCurrent(w);
      if (!w.actions.length) throw new Error('请先添加执行动作');
      const signature = workflowConfiguration(w);
      const savedQueue = checkpoint.analysisComplete ? repo.checkpointRecords(checkpoint) : undefined;
      const waiting = savedQueue?.filter(r => r.status !== 'done' && r.status !== 'skipped') ?? retry?.records ?? repo.pending(id);
      for (const entry of waiting) if (entry.resume?.configuration !== signature) {
        entry.status = 'failed';
        for (const step of entry.actions) if (step.status === 'pending') { step.status = 'failed'; step.result = '编排已修改，原待执行动作已取消'; }
        delete entry.resume; repo.record(entry);
      }
      const pending = waiting.find(entry => entry.status === 'pending');
      const first = waiting[0];
      const accountId = checkpoint.run.accountId ?? first?.accountId;
      let account = this.selectAccount(accountId ? { ...w, accountId } : w);
      run.accountId = account.id; run.accountName = account.name;
      persist();
      setTraceFields({ accountId: account.id, accountName: account.name, actorId: account.actorId });
      trace('workflow.account', '已选定执行账号');
      let identity = w.actions.some(
        (a) => a.type === "follow" || a.type === "reply"
      )
        ? this.deps.x.identity(account.id)
        : null;
      const followedAuthors = new Set((savedQueue ?? []).filter(r => r.actions.some(a => a.type === 'follow' && a.status === 'done'))
        .map(r => r.post.author.toLowerCase()));
      const followSkipReason = (item: OutreachPost, continuingNewFollow = false): string | null => {
        if (!requiresFollow) return null;
        if (item.userId && item.userId === identity!.actorId) return '跳过当前账号';
        const tracked = this.deps.x.followSkipReason?.(identity!, item.userId, item.post.author, continuingNewFollow);
        if (tracked) return tracked;
        if (!continuingNewFollow && (item.following || followedAuthors.has(item.post.author.toLowerCase())))
          return '已经关注，跳过后续动作';
        return null;
      };
      const prepare = (item: OutreachPost, reason: string): WorkflowRecord => ({
        id: randomUUID(), workflowId: id, runId: run.id, accountId: account.id, accountName: account.name,
        post: item.post, reason, status: 'pending', actions: w.actions.map(a => ({ type: a.type, status: 'pending' })),
        createdAt: new Date().toISOString(),
        resume: { configuration: signature, userId: item.userId, following: item.following, actorId: account.actorId },
      });
      const act = async (item: OutreachPost, result: { message: string }, profile?: AccountProfile, existing?: WorkflowRecord) => withTrace({ postId: item.post.id, author: item.post.author }, async () => {
        const post = item.post;
        progress.actions(post.id);
        record = existing ?? prepare(item, result.message);
        if (existing?.resume?.actorId && existing.resume.actorId !== account.actorId)
          throw new Error('执行账号的 X 身份已变化，不能使用其他账号重试原动作');
        const firstUnfinished = existing?.actions.find(step => step.status !== 'done' && step.status !== 'skipped');
        const retryFollow = !!retry && firstUnfinished?.type === 'follow' && (firstUnfinished.status === 'failed' || firstUnfinished.status === 'uncertain');
        if (retry) for (const step of record.actions) if (step.status === 'failed' || step.status === 'uncertain') {
          step.status = 'pending';
          delete step.result;
        }
        record.status = "running";
        // Persist a claim before any external side effect. An ambiguous failure is never retried automatically.
        persist([record], [post.id]);
        const currentRecord = record;
        setTraceFields({ recordId: record.id });
        trace('workflow.post.start', '开始处理命中帖子', { post, reason: result.message, resumed: !!savedQueue || !!retry });
        let newlyFollowed = record.actions.some(step => step.type === 'follow' && step.status === 'done' && step.newlyFollowed === true);
        const ensureEligible = (beforeReply = false) => {
          const reason = followSkipReason(item, newlyFollowed);
          if (reason) throw new FollowSkipped(reason);
          if (requiresFollow && beforeReply && !newlyFollowed)
            throw new FollowSkipped('没有本次新关注成功的记录，跳过回复');
        };
        try {
          if (retryFollow) {
            const step = record.actions.find(step => step.type === 'follow' && step.status === 'pending')!;
            step.status = 'running'; persist([record]);
            if (!item.userId) item.userId = await this.deps.userId(post.author, account.id);
            record.resume!.userId = item.userId;
            trace('workflow.follow.retry', '手动重试：先核对关注关系，再决定是否发送关注', { userId: item.userId });
            const result = this.deps.x.retryFollow
              ? await this.deps.x.retryFollow(identity!, item.userId, post.author)
              : await this.retryUntrackedFollow(identity!, item);
            this.ensureCurrent(w);
            if (!result.following) {
              if (result.created === false) throw new FollowSkipped(result.skipReason ?? '未建立关注关系，跳过后续动作');
              throw new Error('X 未确认关注成功，已停止后续动作');
            }
            step.status = 'done'; step.result = result.created === false ? '已核对为已关注，未重复发送' : '已关注';
            step.newlyFollowed = result.created !== false; newlyFollowed = step.newlyFollowed;
            if (newlyFollowed) progress.followed(post.id);
            persist([record]);
            trace('workflow.action.done', '手动重试关注已核对完成', { action: 'follow', result: step.result, newlyFollowed });
            if (newlyFollowed) progress.followed(post.id);
            // A pre-existing relationship resolves the follow, but does not authorize a new reply.
            if (!newlyFollowed && record.actions.some(step => step.status !== 'done'))
              throw new FollowSkipped('已关注，未重复发送关注，跳过后续动作');
          }
          if (record.actions.every(step => step.status === 'done')) {
            record.status = 'done'; delete record.resume; progress.complete(post.id); persist([record]);
            trace('workflow.post.done', '帖子处理完成', { completed: run.completed });
            record = undefined; return;
          }
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
              if (step.replyText) replyText = step.replyText;
              else if (action.mode === "text") replyText = action.text;
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
              step.replyText = replyText;
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
            persist([record]);
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
              followedAuthors.add(post.author.toLowerCase());
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
            if (repo.get(id)) persist([record]);
            this.ensureCurrent(w);
          }
          record.status = "done";
          delete record.resume;
          progress.complete(post.id);
          persist([record]);
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
          persist([currentRecord]);
          record = undefined;
        }
      });
      const commit = (cursor: string | null, postScan: Workflow['postScan']) => {
        this.ensureCurrent(w);
        repo.write({ ...repo.get(id)!, lastSeenPostId: cursor, postScan });
      };
      const resumeRecords = checkpoint.analysisComplete ? waiting : retry?.records ?? (pending ? [pending] : []);
      if (!checkpoint.analysisComplete && resumeRecords.length) {
        // Legacy failures have only the recorded items; never fabricate missing AI results.
        checkpoint.analysisComplete = true;
        checkpoint.recordIds = resumeRecords.map(r => r.id);
        progress.report({ index: 1, phase: 'analyze', postIds: resumeRecords.map(r => r.post.id),
          decisions: resumeRecords.map(r => ({ postId: r.post.id, matched: true })) });
        persist(resumeRecords.map(r => ({ ...r, runId: run.id })));
      }
      for (const entry of resumeRecords) {
        this.ensureCurrent(w);
        if (entry.status === 'done' || entry.status === 'skipped') continue;
        account = this.selectAccount(entry.accountId ? { ...w, accountId: entry.accountId } : w);
        identity = w.actions.some(a => a.type === 'follow' || a.type === 'reply') ? this.deps.x.identity(account.id) : null;
        setTraceFields({ accountId: account.id, accountName: account.name, actorId: account.actorId });
        await act({ post: entry.post, userId: entry.resume!.userId, name: entry.post.author,
          following: entry.resume!.following, followedBy: null }, { message: entry.reason }, checkpoint.userBatch?.profile, entry);
      }
      if (checkpoint.analysisComplete && checkpoint.userBatch) {
        if (!this.deps.userListener) throw new Error('指定用户监听恢复服务不可用');
        this.deps.userListener.completeWorkflowBatch(id, checkpoint.userBatch, commit);
      }
      if (!checkpoint.analysisComplete) {
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
          const matched = posts.filter(item => !repo.seen(id, item.post.id) && byPost.get(item.post.id)?.matched);
          const records = matched.map(item => prepare(item, byPost.get(item.post.id)!.message));
          const prepared: WorkflowCheckpoint = { ...checkpoint, analysisComplete: true,
            recordIds: records.map(record => record.id), userBatch: batch, progress: progress.snapshot() };
          // Atomic: no external action starts until every validated match and the round's counters are durable.
          repo.saveCheckpoint(prepared, records, decisions.map(d => d.postId));
          Object.assign(checkpoint, prepared);
          trace('workflow.checkpoint.saved', '本轮全部命中项已保存', { runId: run.id, count: records.length, scanned: run.scanned, aiMatched: run.aiMatched });
          for (const [index, item] of matched.entries()) {
            this.ensureCurrent(w);
            await act(item, byPost.get(item.post.id)!, batch?.profile, records[index]!);
          }
        };
        if (w.source === 'user' && this.deps.userListener) {
          await this.deps.userListener.withWorkflowBatch(w, account.id, false, process, commit,
            report, postIds => { progress.scan(postIds); persist(); }, postId => repo.seen(id, postId));
        } else await process();
      }
      this.ensureCurrent(w);
      const current = repo.get(id);
      if (current)
        repo.write({
          ...current,
          lastCheckedAt: new Date().toISOString(),
          lastError: null,
          retryAt: null,
          enabled: retry?.restoreEnabled ? true : current.enabled,
          resumeEnabledAfterFailure: false,
        });
      run.status = "done";
      persist();
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
        if (repo.get(id)) persist([record]);
      }
      const current = repo.get(id);
      if (current && !(error instanceof RunCancelled))
        repo.write({
          ...current,
          enabled: record && !limited ? false : current.enabled,
          resumeEnabledAfterFailure: !!(retry?.restoreEnabled || current.resumeEnabledAfterFailure || (record && !limited && current.enabled)),
          retryAt: limited ? error.resetsAt : null,
          lastCheckedAt: new Date().toISOString(),
          lastError: message,
        });
    }
  }
  private async retryUntrackedFollow(identity: NonNullable<ReturnType<OutreachAdapter['identity']>>, item: OutreachPost) {
    const reason = this.deps.x.followSkipReason?.(identity, item.userId, item.post.author);
    if (reason) return { following: false, created: false, skipReason: reason };
    const relationship = await this.deps.x.relationship(identity, item.userId, item.post.author);
    return relationship.following ? { ...relationship, created: false } : this.deps.x.follow(identity, item.userId, item.post.author);
  }
}
