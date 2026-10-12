import type { OutreachConfig, OutreachConfigInput, OutreachRecord } from '@fast-social/contracts';
import { ValidationError } from '../http/validation.ts';
import { OutreachRepository } from './repository.ts';
import { OutreachXError } from './x-client.ts';
import type { OutreachAdapter, OutreachClassifier } from './types.ts';
import { withXRequestGuard, withQueuedXRequests } from '../adapters/x/request-queue.ts';

const DAY = 86400000;
const CHECK_COOLDOWN = 3600000;
const iso = (now: number) => new Date(now).toISOString();
class FollowSkipped extends Error {}
export function needsRelationshipCheck(row: OutreachRecord, now: number): boolean {
  return row.following && row.followedBy !== true && (!row.lastCheckAttemptAt || now - Date.parse(row.lastCheckAttemptAt) >= CHECK_COOLDOWN);
}
export function automaticCheckDue(row: OutreachRecord, now: number): boolean {
  return needsRelationshipCheck(row, now) && row.followedAt !== null && now - Date.parse(row.followedAt) >= DAY && row.autoCheckAttemptAt === null;
}

export class OutreachRunner {
  private readonly repository: OutreachRepository;
  private readonly social: OutreachAdapter;
  private readonly classifier: OutreachClassifier;
  private readonly now: () => number;
  private active: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private stopped = false;
  private readonly onRequest: (config: OutreachConfig) => void;

  constructor(repository: OutreachRepository, social: OutreachAdapter, classifier: OutreachClassifier, now = Date.now, onRequest: (config: OutreachConfig) => void = () => {}) {
    this.repository = repository; this.social = social; this.classifier = classifier; this.now = now; this.onRequest = onRequest;
    repository.recover();
  }
  view() { return this.repository.view(this.now()); }
  saveConfig(input: unknown) {
    const config = validateConfig(input);
    const previous = this.repository.config();
    let actorId = '';
    if (config.cookieId) {
      try { actorId = this.social.identity(config.cookieId).actorId; }
      catch (error) {
        // Stopping automation must remain possible when credentials expire.
        if (!config.enabled && config.cookieId === previous.cookieId) actorId = previous.actorId;
        else throw new ValidationError(error instanceof Error ? error.message : 'X Cookie 不可用');
      }
    }
    if (actorId !== previous.actorId) throw new ValidationError('此记录绑定的 X 账号不可更换，请添加新的互关账户；同账号可以更新 Cookie');
    if (config.enabled && !actorId) throw new ValidationError('请选择执行互关的 X Cookie');
    const state = this.repository.state();
    this.repository.saveConfig({ ...config, actorId, id: previous.id });
    if (config.requestGapSeconds > previous.requestGapSeconds && state.nextRequestAt) {
      this.repository.patchState({ nextRequestAt: iso(Math.max(Date.parse(state.nextRequestAt), this.now() + config.requestGapSeconds * 1000)) });
    }
    return this.view();
  }
  startChecks() {
    const config = this.repository.config();
    if (!config.actorId) throw new ValidationError('请先选择账号并保存互关配置');
    if (this.repository.state().pauseReason) throw new ValidationError('请求已暂停，请处理错误后点击恢复');
    this.assertIdentity(config);
    const current = this.repository.state().checkJob;
    if (current?.status === 'running') return this.view();
    const ids = this.repository.all().filter(row => row.actorId === config.actorId && needsRelationshipCheck(row, this.now())).reverse().map(row => row.id);
    this.repository.patchState({ checkJob: { actorId: config.actorId, ids, completed: 0, status: ids.length ? 'running' : 'done' } });
    return this.view();
  }
  stopChecks() {
    const job = this.repository.state().checkJob;
    if (job?.status === 'running') this.repository.patchState({ checkJob: { ...job, status: 'stopped' } });
    return this.view();
  }
  resume() {
    this.assertIdentity(this.repository.config());
    this.repository.patchState({ pauseReason: null });
    return this.view();
  }
  start() {
    if (this.timer) return;
    this.stopped = false;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), 5000);
    this.timer.unref();
  }
  async stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.active;
  }
  tick(): Promise<void> {
    if (this.stopped || this.active) return this.active ?? Promise.resolve();
    this.active = withQueuedXRequests(() => this.step()).catch(error => this.pause(error)).finally(() => { this.active = null; });
    return this.active;
  }
  private assertIdentity(config: OutreachConfig) {
    try {
      if (!config.actorId || this.social.identity(config.cookieId).actorId !== config.actorId) throw new Error('互关执行账号已改变，请重新保存配置');
    } catch (error) { throw new ValidationError(error instanceof Error ? error.message : '执行账号不可用'); }
  }
  private reserve(config: OutreachConfig) {
    this.assertIdentity(config);
    this.repository.patchState({ nextRequestAt: iso(this.now() + config.requestGapSeconds * 1000) });
    this.onRequest(config);
  }
  private pause(error: unknown) {
    if (!this.repository.exists()) return;
    const state = this.repository.state();
    this.repository.patchState({
      pauseReason: error instanceof Error ? error.message : '互关执行失败',
      nextRequestAt: iso(Math.max(Date.parse(state.nextRequestAt ?? '') || 0, this.now() + (error instanceof OutreachXError ? error.retryAfterSeconds : 0) * 1000)),
      ...(state.checkJob?.status === 'running' ? { checkJob: { ...state.checkJob, status: 'stopped' as const } } : {}),
    });
  }
  private async step() {
    const config = this.repository.config();
    const state = this.repository.state();
    const now = this.now();
    if (state.pauseReason || (state.nextRequestAt && Date.parse(state.nextRequestAt) > now) || !config.actorId) return;
    const rows = this.repository.all().filter(row => row.actorId === config.actorId).reverse();
    if (config.enabled) {
      const pendingReply = rows.find(row => row.stage === 'pending_reply');
      if (pendingReply) return this.reply(config, pendingReply);
    }
    const job = state.checkJob;
    if (job?.status === 'running') {
      if (job.actorId !== config.actorId) { this.stopChecks(); return; }
      // Consume skipped records locally without issuing any X requests.
      while (job.completed < job.ids.length) {
        const row = this.repository.get(job.ids[job.completed]!);
        job.completed += 1;
        if (row?.actorId === config.actorId && needsRelationshipCheck(row, now)) {
          this.reserve(config);
          this.repository.patchState({ checkJob: { ...job } });
          await this.check(config, row, automaticCheckDue(row, now));
          const latest = this.repository.state().checkJob;
          if (latest?.status === 'running' && latest.completed === latest.ids.length) this.repository.patchState({ checkJob: { ...latest, status: 'done' } });
          return;
        }
      }
      this.repository.patchState({ checkJob: { ...job, status: 'done' } });
    }
    if (!config.enabled) return;
    const due = rows.find(row => automaticCheckDue(row, now));
    if (due) { this.reserve(config); await this.check(config, due, true); return; }
    if (this.repository.attempts(config.actorId, now) >= config.dailyLimit) return;
    const pending = rows.find(row => row.stage === 'pending_follow');
    if (pending) {
      if (now - Date.parse(pending.postCreatedAt) > DAY) {
        this.repository.patch(pending.id, { stage: 'skipped', actionError: '原帖超过 24 小时，跳过互动' });
        return;
      }
      return this.follow(config, pending);
    }
    if (!state.lastFetchedAt || now - Date.parse(state.lastFetchedAt) >= config.intervalMinutes * 60000) await this.discover(config);
  }
  private async discover(config: OutreachConfig) {
    this.reserve(config);
    const started = this.now();
    this.repository.patchState({ lastFetchedAt: iso(started) });
    const found = await this.social.home(config, this.repository.recentSeen(config.actorId));
    let budget = 20000;
    const posts = found.filter(item => {
      const length = item.post.text.length + (item.post.quotedText?.length ?? 0);
      const time = Date.parse(item.post.createdAt);
      if (item.userId === config.actorId || item.following === true || item.post.type === 'repost' || this.repository.get(`${config.actorId}:${item.userId}`) || this.repository.seen(config.actorId, item.post.id) || !Number.isFinite(time) || time < started - DAY || time > started + 60000 || length > 4000 || length > budget) return false;
      budget -= length;
      return true;
    });
    const decisions = posts.length ? await this.classifier.classify(posts, config.prompt) : [];
    // Settings can change while an AI request is in flight. No stale work is enqueued.
    if (this.stopped || !this.repository.exists() || JSON.stringify(this.repository.config()) !== JSON.stringify(config)) return;
    const available = config.dailyLimit - this.repository.attempts(config.actorId, started);
    let added = 0;
    for (const decision of decisions) {
      if (decision.status !== 'match' || added >= available) continue;
      const item = posts.find(item => item.post.id === decision.postId)!;
      const id = `${config.actorId}:${item.userId}`;
      if (this.repository.get(id)) continue;
      this.repository.add({
        id, actorId: config.actorId, userId: item.userId, username: item.post.author, name: item.name,
        postId: item.post.id, postText: item.post.text, postCreatedAt: item.post.createdAt, reason: decision.reason, replyText: config.replyText,
        stage: 'pending_follow', following: false, followedBy: item.followedBy, createdAt: iso(this.now()),
        followAttemptAt: null, followedAt: null, repliedAt: null, replyId: null, autoCheckAttemptAt: null,
        lastCheckAttemptAt: null, lastCheckedAt: null, checkState: 'idle', actionError: null, checkError: null,
      });
      added += 1;
    }
    this.repository.markSeen(config.actorId, found.map(item => item.post.id), this.now());
  }
  private async follow(config: OutreachConfig, row: OutreachRecord) {
    this.reserve(config);
    this.repository.patch(row.id, { stage: 'following', followAttemptAt: iso(this.now()) });
    try {
      const result = await this.social.follow(config, row.userId, row.username);
      this.repository.patch(row.id, { following: result.following, followedBy: result.followedBy ?? row.followedBy,
        stage: result.following && result.created !== false && this.repository.exists() ? 'pending_reply' : 'skipped',
        followedAt: result.following && result.created !== false ? iso(this.now()) : null,
        actionError: result.created === false ? result.skipReason ?? '未建立新的关注关系，未发送回复'
          : !this.repository.exists() ? '互关账户已移除，未继续发送回复' : result.following ? null : '关注尚未生效，未发送回复，请查看用户主页' });
    } catch (error) {
      this.repository.patch(row.id, { stage: 'uncertain', actionError: '关注结果待确认，未回复；请打开用户主页核对，不会自动重发' });
      throw error;
    }
  }
  private async reply(config: OutreachConfig, row: OutreachRecord) {
    // Only a confirmed follow can create a reply. A subsequent manual unfollow also prevents it.
    if (!row.following || !row.followedAt) { this.repository.patch(row.id, { stage: 'skipped' }); return; }
    const skip = this.social.followSkipReason?.(config, row.userId, row.username, true);
    if (skip) { this.repository.patch(row.id, { stage: 'skipped', actionError: skip }); return; }
    this.reserve(config);
    this.repository.patch(row.id, { stage: 'replying' });
    try {
      const replyId = await withXRequestGuard(() => {
        const reason = this.social.followSkipReason?.(config, row.userId, row.username, true);
        if (reason) throw new FollowSkipped(reason);
      }, () => this.social.reply(config, row.postId, row.replyText));
      this.repository.patch(row.id, { stage: 'done', replyId, repliedAt: iso(this.now()), actionError: null });
    } catch (error) {
      if (error instanceof FollowSkipped) { this.repository.patch(row.id, { stage: 'skipped', actionError: error.message }); return; }
      this.repository.patch(row.id, { stage: 'uncertain', actionError: '回复结果待确认；请打开原帖核对，不会自动重发' });
      throw error;
    }
  }
  private async check(config: OutreachConfig, row: OutreachRecord, auto: boolean) {
    this.repository.patch(row.id, { lastCheckAttemptAt: iso(this.now()), checkState: 'checking', checkError: null, ...(auto ? { autoCheckAttemptAt: iso(this.now()) } : {}) });
    try {
      const relation = await this.social.relationship(config, row.userId, row.username);
      this.repository.patch(row.id, { ...relation, lastCheckedAt: iso(this.now()), checkState: 'idle', checkError: null });
    } catch (error) {
      this.repository.patch(row.id, { checkState: 'error', checkError: error instanceof Error ? error.message : '关系检查失败' });
      throw error;
    }
  }
}

export function validateConfig(input: unknown): OutreachConfigInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ValidationError('互关配置必须为对象');
  const value = input as Record<string, unknown>;
  const allowed = new Set(['name', 'enabled', 'cookieId', 'prompt', 'intervalMinutes', 'dailyLimit', 'requestGapSeconds', 'replyText']);
  if (Object.keys(value).some(key => !allowed.has(key))) throw new ValidationError('互关配置包含未知字段');
  const text = (key: string, limit: number, empty = false) => {
    const result = value[key];
    if (typeof result !== 'string' || (!empty && !result.trim()) || result.length > limit) throw new ValidationError(`${key} 必须为${empty ? '' : '非空'}文本，最多 ${limit} 字`);
    return result.trim();
  };
  const integer = (key: string, min: number, max: number) => {
    const result = value[key];
    if (typeof result !== 'number' || !Number.isInteger(result) || result < min || result > max) throw new ValidationError(`${key} 必须为 ${min}～${max} 的整数`);
    return result;
  };
  if (typeof value.enabled !== 'boolean') throw new ValidationError('enabled 必须为布尔值');
  return { name: text('name', 80), enabled: value.enabled, cookieId: text('cookieId', 200), prompt: text('prompt', 2000), replyText: text('replyText', 100), intervalMinutes: integer('intervalMinutes', 15, 1440), dailyLimit: integer('dailyLimit', 1, 100), requestGapSeconds: integer('requestGapSeconds', 15, 3600) };
}
