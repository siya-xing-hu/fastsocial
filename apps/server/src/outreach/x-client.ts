import type { SettingsRepository } from '../repositories/settings-repository.ts';
import { X_FEATURES, X_OPERATIONS, X_WEB_BEARER_TOKEN, X_WEB_USER_AGENT } from '../adapters/x/x-operations.ts';
import { parseXTimeline, parseXAccount } from '../adapters/x/x-parser.ts';
import type { OutreachAdapter, OutreachIdentity, OutreachPost, OutreachRelationship } from './types.ts';
import type { AccountRequestAction, XProfileRelationship } from '@fast-social/contracts';
import type { XRequestQueue } from '../adapters/x/request-queue.ts';
import { assertCurrentXCookie } from '../adapters/x/x-client.ts';

// Reply/user operations use X's main.60bedca26c9a9faaa.js. HomeTimeline is a
// POST read; seed from fa0311/twitter_api_safe_relay_skills requests.ndjson.
// All operation IDs can be updated independently when the web client changes.
export const OUTREACH_OPERATIONS = {
  home: X_OPERATIONS.homeTimeline,
  reply: { name: 'CreateTweet', id: process.env.X_CREATE_TWEET_OPERATION_ID ?? 'GYdIGqVWfZNho79bQ2XDoA' },
  user: { name: 'UserByRestId', id: process.env.X_USER_BY_REST_ID_OPERATION_ID ?? 'IdmRdjYxIGI39Hdwkwo5cQ' },
};
type ObjectValue = Record<string, any>;
const object = (value: unknown): ObjectValue => value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {};
const validId = (value: unknown): value is string => typeof value === 'string' && /^[1-9]\d*$/.test(value);
const bool = (value: unknown): boolean | null => typeof value === 'boolean' ? value : null;

export class OutreachXError extends Error {
  readonly retryAfterSeconds: number;
  constructor(message: string, retryAfterSeconds = 0) { super(message); this.retryAfterSeconds = retryAfterSeconds; }
}

export function cookieActorId(cookie: string): string {
  try {
    const value = decodeURIComponent(readCookie(cookie, 'twid') ?? '').replace(/^"|"$/g, '');
    const id = /^u=([1-9]\d*)$/.exec(value)?.[1];
    if (id) return id;
  } catch { /* Present a useful configuration error below. */ }
  throw new Error('互关功能需要含 twid 的完整 X Cookie，以固定执行账号；请更新连接配置');
}

export function parseHomePosts(payload: unknown): OutreachPost[] {
  const home = object(object(object(payload).data).home);
  const instructions = object(home.home_timeline_urt ?? home.home_timeline).instructions;
  if (!Array.isArray(instructions)) throw new Error('X 首页响应结构已变化，无法读取帖子');
  const results: OutreachPost[] = [];
  const seen = new Set<string>();
  const append = (content: unknown) => {
    const item = object(content);
    if (item.promotedMetadata) return;
    const wrapped = object(object(item.tweet_results).result);
    const tweet = wrapped.__typename === 'TweetWithVisibilityResults' ? object(wrapped.tweet) : wrapped;
    const user = object(object(object(tweet.core).user_results).result);
    const legacy = object(user.legacy);
    if (legacy.protected === true || object(user.privacy).protected === true) return;
    const id = user.rest_id;
    // Only map the actual timeline item; never treat a quoted tweet as a hit.
    const post = parseXTimeline({ tweet_results: { result: tweet } }).find(post => post.id === tweet.rest_id);
    if (!validId(id) || !post || !validId(post.id) || !/^[A-Za-z0-9_]{1,15}$/.test(post.author) || post.type === 'repost' || seen.has(post.id)) return;
    seen.add(post.id);
    const relationship = object(user.relationship_perspectives);
    const name = object(user.core).name ?? legacy.name;
    results.push({ post, userId: id, name: typeof name === 'string' ? name : post.author,
      following: bool(relationship.following ?? legacy.following), followedBy: bool(relationship.followed_by ?? legacy.followed_by) });
  };
  for (const instruction of instructions) {
    if (instruction.type === 'TimelinePinEntry') continue;
    const entries = instruction.entries ?? (instruction.entry ? [instruction.entry] : []);
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const content = object(object(entry).content);
      if (content.promotedMetadata || String(object(entry).entryId ?? '').startsWith('promoted-')) continue;
      append(content.itemContent);
      if (Array.isArray(content.items)) for (const moduleItem of content.items) append(object(object(moduleItem).item).itemContent);
    }
  }
  return results.slice(0, 20);
}

export function parseRelationship(payload: unknown, userId: string): OutreachRelationship {
  const relationship = parseFollowState(payload, userId);
  if (relationship.followedBy === null) throw new Error('X 未返回完整关注关系，保留原记录');
  return { following: relationship.following, followedBy: relationship.followedBy };
}

export function parseFollowState(payload: unknown, userId: string): { following: boolean; followedBy: boolean | null } {
  const user = object(object(object(payload).data).user).result;
  if (object(user).rest_id !== userId) throw new Error('X 关系查询未返回目标用户');
  const perspectives = object(object(user).relationship_perspectives);
  const legacy = object(object(user).legacy);
  const following = bool(perspectives.following ?? legacy.following);
  const followedBy = bool(perspectives.followed_by ?? legacy.followed_by);
  if (following === null) throw new Error('X 未返回完整关注关系，保留原记录');
  return { following, followedBy };
}

export class OutreachXClient implements OutreachAdapter {
  private readonly settings: SettingsRepository;
  private readonly fetchImpl: typeof fetch;
  private readonly requests: XRequestQueue;
  constructor(settings: SettingsRepository, requests: XRequestQueue, fetchImpl: typeof fetch = fetch) {
    this.settings = settings; this.requests = requests; this.fetchImpl = fetchImpl;
  }

  private cookie(cookieId: string): string {
    const entry = this.settings.getX().cookies.find(entry => entry.id === cookieId);
    if (!entry?.enabled || !entry.cookie?.trim() || entry.status === 'invalid') throw new Error('互关所选 Cookie 不可用，请检查连接配置');
    if (!readCookie(entry.cookie, 'auth_token') || !readCookie(entry.cookie, 'ct0')) throw new Error('所选 X Cookie 缺少 auth_token 或 ct0');
    return entry.cookie;
  }
  identity(cookieId: string): OutreachIdentity { return { cookieId, actorId: cookieActorId(this.cookie(cookieId)) }; }
  async home(identity: OutreachIdentity, seenPostIds: string[]): Promise<OutreachPost[]> {
    return parseHomePosts(await this.graphql(identity, OUTREACH_OPERATIONS.home, {
      count: 20, includePromotedContent: false, withCommunity: true, seenTweetIds: seenPostIds.slice(0, 20),
    }, true));
  }
  async follow(identity: OutreachIdentity, userId: string, username?: string): Promise<{ following: boolean; followedBy: boolean | null }> {
    const value = object(await this.request(identity, 'https://x.com/i/api/1.1/friendships/create.json', 'follow', {
      method: 'POST', body: new URLSearchParams({ user_id: userId, follow: 'false' }).toString(), contentType: 'application/x-www-form-urlencoded',
    }));
    if (value.id_str !== userId) throw new Error('X 未确认关注结果，请打开用户主页核对');
    if (value.following === true) return { following: true, followedBy: bool(value.followed_by) };
    // The mutation response may still carry the earlier relationship. Never repeat the mutation to verify it.
    try {
      let state = await this.followState(identity, userId, username);
      if (!state.following) {
        state = await this.followState(identity, userId, username);
      }
      return state;
    } catch (error) {
      // Even a local read-quota failure occurs AFTER the follow was sent. It is not a safely retryable unsent action.
      throw new OutreachXError(`关注请求已发送，但核对结果失败：${error instanceof Error ? error.message : '未知错误'}；未重复关注，请核对执行记录`,
        error instanceof OutreachXError ? error.retryAfterSeconds : 0);
    }
  }
  async profile(identity: OutreachIdentity, username: string, expectedId?: string): Promise<XProfileRelationship> {
    const handle = username.trim().replace(/^@/, '');
    if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) throw new Error('请填写有效的 X 用户名');
    const payload = await this.graphql(identity, X_OPERATIONS.userByScreenName, { screen_name: handle, withGrokTranslatedBio: true }, false,
      X_OPERATIONS.userByScreenName.fieldToggles, `https://x.com/${handle}`);
    const account = parseXAccount(payload, handle);
    if (!validId(account.id) || (expectedId && account.id !== expectedId) || account.username.toLowerCase() !== handle.toLowerCase())
      throw new Error('Profile 与目标用户不一致，请核对用户是否改名');
    return { account, ...parseFollowState(payload, account.id) };
  }
  async followState(identity: OutreachIdentity, userId: string, username?: string): Promise<{ following: boolean; followedBy: boolean | null }> {
    if (username) { const { following, followedBy } = await this.profile(identity, username, userId); return { following, followedBy }; }
    return parseFollowState(await this.graphql(identity, OUTREACH_OPERATIONS.user, { userId, withSafetyModeUserFields: true }, false,
      { withPayments: false, withAuxiliaryUserLabels: true }), userId);
  }
  async unfollow(identity: OutreachIdentity, userId: string, username: string): Promise<{ following: boolean; followedBy: boolean | null }> {
    const value = object(await this.request(identity, 'https://x.com/i/api/1.1/friendships/destroy.json', 'unfollow', {
      method: 'POST', body: new URLSearchParams({ user_id: userId }).toString(), contentType: 'application/x-www-form-urlencoded',
    }));
    if (value.id_str !== userId) throw new Error('X 未确认取消关注结果，请核对用户主页');
    if (value.following === false) return { following: false, followedBy: bool(value.followed_by) };
    try {
      let state = await this.followState(identity, userId, username);
      if (state.following) state = await this.followState(identity, userId, username);
      if (state.following) throw new Error('Profile 仍显示已关注');
      return state;
    } catch (error) { throw new OutreachXError(`取消关注请求已发送，但核对失败：${error instanceof Error ? error.message : '未知错误'}；未重复发送`); }
  }
  async reply(identity: OutreachIdentity, postId: string, text: string): Promise<string> {
    const payload = object(await this.graphql(identity, OUTREACH_OPERATIONS.reply, {
      tweet_text: text, dark_request: false, reply: { in_reply_to_tweet_id: postId, exclude_reply_user_ids: [] },
      media: { media_entities: [], possibly_sensitive: false }, semantic_annotation_ids: [], disallowed_reply_options: null,
    }, true));
    const result = object(object(object(payload.data).create_tweet).tweet_results).result;
    const id = object(result).rest_id;
    if (!validId(id)) throw new Error('X 未确认回复结果，请打开原帖核对');
    return id;
  }
  async relationship(identity: OutreachIdentity, userId: string, username?: string): Promise<OutreachRelationship> {
    if (username) {
      const state = await this.profile(identity, username, userId);
      if (state.followedBy === null) throw new Error('X 未返回完整关注关系，保留原记录');
      return { following: state.following, followedBy: state.followedBy };
    }
    return parseRelationship(await this.graphql(identity, OUTREACH_OPERATIONS.user, { userId, withSafetyModeUserFields: true }, false, { withPayments: false, withAuxiliaryUserLabels: true }), userId);
  }
  private graphql(identity: OutreachIdentity, operation: { id: string; name: string }, variables: Record<string, unknown>, post = false, fieldToggles: Record<string, boolean> = {}, referer = 'https://x.com/home'): Promise<unknown> {
    const url = `https://x.com/i/api/graphql/${operation.id}/${operation.name}`;
    const parameters = { variables, features: X_FEATURES, fieldToggles };
    const action = operation.name === OUTREACH_OPERATIONS.home.name ? 'home' : operation.name === OUTREACH_OPERATIONS.reply.name ? 'reply' : 'profile';
    return post
      ? this.request(identity, url, action, { method: 'POST', contentType: 'application/json', body: JSON.stringify({ ...parameters, queryId: operation.id }) })
      : this.request(identity, `${url}?${new URLSearchParams(Object.entries(parameters).map(([key, value]) => [key, JSON.stringify(value)]))}`, action, { referer });
  }
  private async request(identity: OutreachIdentity, url: string, action: AccountRequestAction, options: { method?: string; body?: string; contentType?: string; referer?: string } = {}): Promise<unknown> {
    const cookie = this.cookie(identity.cookieId);
    if (cookieActorId(cookie) !== identity.actorId) throw new Error('Cookie 对应账号已改变，请重新保存互关配置');
    return this.requests.request(async () => {
      const response = await this.fetchImpl(url, {
        method: options.method ?? 'GET', body: options.body, redirect: 'error', signal: AbortSignal.timeout(20_000),
        headers: {
          authorization: `Bearer ${X_WEB_BEARER_TOKEN}`, cookie, 'x-csrf-token': readCookie(cookie, 'ct0')!,
          'x-twitter-active-user': 'yes', 'x-twitter-auth-type': 'OAuth2Session', 'x-twitter-client-language': 'en',
          'user-agent': X_WEB_USER_AGENT, origin: 'https://x.com', referer: options.referer ?? 'https://x.com/home',
          'accept-language': 'en-US,en;q=0.9', 'sec-fetch-dest': 'empty', 'sec-fetch-mode': 'cors', 'sec-fetch-site': 'same-origin', accept: '*/*',
          ...(options.contentType ? { 'content-type': options.contentType } : {}),
        },
      });
      const retryHeader = response.headers.get('retry-after');
      const retryAfter = retryHeader ? (/^\d+$/.test(retryHeader) ? Number(retryHeader) : Math.max(0, (Date.parse(retryHeader) - Date.now()) / 1000)) : 0;
      const cooldown = Math.max(Number.isFinite(retryAfter) ? retryAfter : 0, response.status === 429 ? 3600 : 0);
      const body = await response.text();
      let payload: unknown;
      try { payload = JSON.parse(body); } catch {
        if (response.status === 401) this.settings.updateXCookieStatus(identity.cookieId, cookie, 'invalid', '互关请求认证失败');
        if (response.status === 403) {
          const operation = action === 'profile' ? '关注关系查询' : action === 'home' ? '首页读取' : action === 'reply' ? '回复请求' : '关注请求';
          const cloudflare = /cloudflare/i.test(response.headers.get('server') ?? '') || /<title>[^<]*Cloudflare/i.test(body);
          throw new OutreachXError(cloudflare
            ? `X 的 Cloudflare 防护拒绝了${operation}（HTTP 403），未返回接口结果；请在浏览器检查 X 访问状态`
            : `X 拒绝了${operation}（HTTP 403），返回了非 JSON 页面；请在浏览器检查 X 访问状态`, cooldown);
        }
        throw new OutreachXError(`X 返回无效数据（${response.status}），已暂停`, cooldown);
      }
      const errors = object(payload).errors;
      const codes = Array.isArray(errors) ? errors.map(error => Number(object(error).code)) : [];
      if (response.status === 401 || codes.some(code => [32, 89, 99, 215, 353].includes(code))) {
        this.settings.updateXCookieStatus(identity.cookieId, cookie, 'invalid', '互关请求认证失败');
        throw new OutreachXError('X Cookie 认证失败，已暂停');
      }
      // X may return HTTP 200 with an application-level refusal. This is neither
      // a successful write nor evidence of an invalid Cookie or request parameter.
      if (codes.includes(226)) {
        const operation = { home: '首页读取', profile: 'Profile / 关系查询', posts: '帖子读取',
          follow: '关注请求', unfollow: '取消关注请求', reply: '回复请求' }[action];
        throw new OutreachXError(`X 拒绝了${operation}（代码 226，HTTP ${response.status}）：被判定为可能的自动化或垃圾内容；请在 X 检查账号状态，勿连续重试`, cooldown);
      }
      if (!response.ok || (Array.isArray(errors) && errors.length > 0)) {
        throw new OutreachXError(`X 请求失败（${response.status}${codes.length ? `，代码 ${codes.join(',')}` : ''}），已暂停；请核对账号或请求参数`, cooldown);
      }
      return payload;
    }, () => {
      assertCurrentXCookie(this.settings, identity.cookieId, cookie);
      this.cookie(identity.cookieId);
      this.settings.configuration.requestLimits.consume(identity.cookieId, action);
    }, { accountId: identity.cookieId, actorId: identity.actorId, operation: action });
  }
}
function readCookie(cookie: string, name: string): string | undefined {
  const part = cookie.split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`));
  return part?.slice(name.length + 1);
}
