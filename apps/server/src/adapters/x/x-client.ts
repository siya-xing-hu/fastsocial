import type { SettingsRepository } from "../../repositories/settings-repository.ts";
import type { StoredXCookie } from "../../repositories/settings-repository.ts";
import { X_FEATURES, X_OPERATIONS, X_WEB_BEARER_TOKEN, X_WEB_USER_AGENT } from "./x-operations.ts";
import { parseXTimeline, parseXUserId, parseXAccount, parseXTimelinePage } from "./x-parser.ts";
import type { SocialPost, SocialAccount, TimelinePage } from "@fast-social/contracts";

export type FetchLike = typeof fetch;
export type RandomLike = () => number;

const X_AUTH_ERROR_CODES = new Set([32, 89, 99, 215, 353]);

class XAuthenticationError extends Error {}

export class XClient {
  private readonly settings: SettingsRepository;
  private readonly fetchImpl: FetchLike;
  private readonly random: RandomLike;

  constructor(
    settings: SettingsRepository,
    fetchImpl: FetchLike = fetch,
    random: RandomLike = Math.random,
  ) {
    this.settings = settings;
    this.fetchImpl = fetchImpl;
    this.random = random;
  }

  async fetchRecentPosts(username: string, cookieId?: string): Promise<SocialPost[]> {
    const user = username.trim().replace(/^@/, "");
    if (!user) throw new Error("请填写 X 用户名");

    return this.withCookie(cookie => this.fetchWithCookie(user, cookie), cookieId);
  }

  async fetchAccount(username: string): Promise<SocialAccount> {
    const user = username.trim().replace(/^@/, '');
    return this.withCookie(async cookie => parseXAccount(await this.graphql(cookie,
      X_OPERATIONS.userByScreenName, { screen_name: user, withGrokTranslatedBio: true },
      `https://x.com/${encodeURIComponent(user)}`), user));
  }

  async fetchTimelinePage(account: SocialAccount, cursor?: string, surface: "posts" | "replies" = "posts"): Promise<TimelinePage> {
    return this.withCookie(async cookie => parseXTimelinePage(await this.graphql(cookie,
      surface === "replies" ? X_OPERATIONS.userReplies : X_OPERATIONS.userTweets, {
        userId: account.id, count: 40, includePromotedContent: false,
        withCommunity: true, withVoice: true, withQuickPromoteEligibilityTweetFields: false, ...(cursor ? { cursor } : {}),
      }, `https://x.com/${encodeURIComponent(account.username)}/with_replies`), account.username));
  }

  private async withCookie<T>(action: (cookie: string) => Promise<T>, cookieId?: string): Promise<T> {
    const candidates = this.cookieCandidates(cookieId).slice(0, cookieId ? 1 : 2);
    if (!cookieId && candidates.length === 1) candidates.push(candidates[0]!);
    let lastError: unknown;
    for (const entry of candidates) {
      const storedCookie = entry.cookie ?? '';
      try {
        const result = await action(storedCookie.trim());
        this.settings.updateXCookieStatus(entry.id, storedCookie, 'valid');
        return result;
      } catch (error) {
        lastError = error;
        if (error instanceof XAuthenticationError) {
          this.settings.updateXCookieStatus(entry.id, storedCookie, 'invalid', error.message);
          if (candidates[1]?.id === entry.id) break;
        }
      }
    }
    if (lastError instanceof XAuthenticationError) {
      throw new Error(`X Cookie 认证失败：${lastError.message}`);
    }
    throw lastError ?? new Error('没有可用的 X Cookie');
  }

  private async fetchWithCookie(user: string, cookie: string): Promise<SocialPost[]> {
    const referer = `https://x.com/${encodeURIComponent(user)}`;
    const userPayload = await this.graphql(cookie, X_OPERATIONS.userByScreenName, {
      screen_name: user,
      withGrokTranslatedBio: true,
    }, referer);
    const userId = parseXUserId(userPayload);
    const timeline = await this.graphql(cookie, X_OPERATIONS.userTweets, {
      userId,
      count: 40,
      includePromotedContent: false,
      withQuickPromoteEligibilityTweetFields: false,
      withVoice: true,
    }, referer);
    return parseXTimeline(timeline).filter(
      (post) => post.author.toLowerCase() === user.toLowerCase(),
    );
  }

  private cookieCandidates(cookieId?: string): StoredXCookie[] {
    const all = this.settings.getX().cookies;
    if (cookieId) {
      const selected = all.find((entry) => entry.id === cookieId);
      if (!selected) throw new Error("指定的 X Cookie 不存在");
      if (!selected.cookie?.trim()) throw new Error(`X Cookie「${selected.name}」尚未配置`);
      return [selected];
    }

    const configured = all.filter((entry) => Boolean(entry.cookie?.trim()));
    if (configured.length === 0) throw new Error("请先配置 X Cookie");
    const enabled = configured.filter((entry) => entry.enabled);
    if (enabled.length === 0) throw new Error("没有已启用的 X Cookie");
    const usable = enabled.filter((entry) => entry.status !== "invalid");
    if (usable.length === 0) throw new Error("所有已启用的 X Cookie 均已失效，请更新 Cookie");

    // Random selection without usage accounting; a retry takes a different Cookie.
    const shuffled = [...usable];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const other = Math.max(0, Math.min(index, Math.floor(this.random() * (index + 1))));
      [shuffled[index], shuffled[other]] = [shuffled[other]!, shuffled[index]!];
    }
    return shuffled;
  }

  private async graphql(
    cookie: string,
    operation: { id: string; name: string; fieldToggles: Record<string, boolean> },
    variables: Record<string, unknown>,
    referer: string,
  ): Promise<unknown> {
    if (!readCookie(cookie, "auth_token")) {
      throw new XAuthenticationError("Cookie 中缺少 auth_token");
    }
    const csrf = readCookie(cookie, "ct0");
    if (!csrf) throw new XAuthenticationError("Cookie 中缺少 ct0");

    const query = new URLSearchParams({
      variables: JSON.stringify(variables),
      features: JSON.stringify(X_FEATURES),
      fieldToggles: JSON.stringify(operation.fieldToggles),
    });
    const url = `https://x.com/i/api/graphql/${operation.id}/${operation.name}?${query}`;
    const response = await this.fetchImpl(url, {
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
      headers: {
        authorization: `Bearer ${X_WEB_BEARER_TOKEN}`,
        cookie,
        "x-csrf-token": csrf,
        "x-twitter-active-user": "yes",
        "x-twitter-auth-type": "OAuth2Session",
        "x-twitter-client-language": "en",
        // X's web endpoints can return an empty 404 to requests missing browser
        // context even when the operation ID and session Cookie are valid.
        "user-agent": X_WEB_USER_AGENT,
        origin: "https://x.com",
        referer,
        "accept-language": "en-US,en;q=0.9",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        accept: "*/*",
      },
    });
    if (response.status === 401) {
      throw new XAuthenticationError("X 接口拒绝了该 Cookie（401）");
    }
    if (response.status === 403) {
      const payload = await readResponseJson(response);
      if (hasAuthenticationError(payload)) {
        throw new XAuthenticationError(authenticationErrorMessage(payload));
      }
      throw new Error("X 接口请求失败（403）");
    }
    if (!response.ok) {
      const hint = response.status === 404
        ? "；请核对当前 X 网页的请求标识和浏览器请求头"
        : "";
      throw new Error(`X 网页请求 ${operation.name} 失败（${response.status}）${hint}`);
    }
    const payload = await response.json();
    if (hasAuthenticationError(payload)) {
      throw new XAuthenticationError(authenticationErrorMessage(payload));
    }
    const errors = responseErrors(payload);
    if (errors.length) {
      throw new Error(errors[0]?.message || "X 接口返回错误");
    }
    return payload;
  }
}

interface XResponseError {
  code?: number | string;
  message?: string;
  extensions?: { code?: number | string };
}

function responseErrors(payload: unknown): XResponseError[] {
  if (!payload || typeof payload !== "object") return [];
  const errors = (payload as { errors?: unknown }).errors;
  return Array.isArray(errors) ? errors as XResponseError[] : [];
}

function hasAuthenticationError(payload: unknown): boolean {
  return responseErrors(payload).some((error) => {
    const value = error.code ?? error.extensions?.code;
    return X_AUTH_ERROR_CODES.has(Number(value));
  });
}

function authenticationErrorMessage(payload: unknown): string {
  return responseErrors(payload).find((error) => {
    const value = error.code ?? error.extensions?.code;
    return X_AUTH_ERROR_CODES.has(Number(value));
  })?.message || "X Cookie 已失效";
}

async function readResponseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function readCookie(cookie: string, name: string): string | undefined {
  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return undefined;
}
