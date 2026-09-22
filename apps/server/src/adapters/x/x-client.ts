import type { SettingsRepository } from "../../repositories/settings-repository.ts";
import { X_FEATURES, X_OPERATIONS, X_WEB_BEARER_TOKEN } from "./x-operations.ts";
import { parseXTimeline, parseXUserId } from "./x-parser.ts";
import type { SocialPost } from "@fast-social/contracts";

export type FetchLike = typeof fetch;

export class XClient {
  private readonly settings: SettingsRepository;
  private readonly fetchImpl: FetchLike;

  constructor(settings: SettingsRepository, fetchImpl: FetchLike = fetch) {
    this.settings = settings;
    this.fetchImpl = fetchImpl;
  }

  async fetchRecentPosts(username: string): Promise<SocialPost[]> {
    const user = username.trim().replace(/^@/, "");
    if (!user) throw new Error("请填写 X 用户名");
    const userPayload = await this.graphql(X_OPERATIONS.userByScreenName, {
      screen_name: user,
      withSafetyModeUserFields: true,
    });
    const userId = parseXUserId(userPayload);
    const timeline = await this.graphql(X_OPERATIONS.userTweets, {
      userId,
      count: 40,
      includePromotedContent: false,
      withQuickPromoteEligibilityTweetFields: false,
      withVoice: true,
      withV2Timeline: true,
    });
    return parseXTimeline(timeline).filter(
      (post) => post.author.toLowerCase() === user.toLowerCase(),
    );
  }

  private async graphql(
    operation: { id: string; name: string },
    variables: Record<string, unknown>,
  ): Promise<unknown> {
    const cookie = this.settings.getX().cookie?.trim();
    if (!cookie) throw new Error("请先配置 X Cookie");
    const csrf = readCookie(cookie, "ct0");
    if (!csrf) throw new Error("X Cookie 中缺少 ct0");

    const query = new URLSearchParams({
      variables: JSON.stringify(variables),
      features: JSON.stringify(X_FEATURES),
    });
    const url = `https://x.com/i/api/graphql/${operation.id}/${operation.name}?${query}`;
    const response = await this.fetchImpl(url, {
      signal: AbortSignal.timeout(15_000),
      headers: {
        authorization: `Bearer ${X_WEB_BEARER_TOKEN}`,
        cookie,
        "x-csrf-token": csrf,
        "x-twitter-active-user": "yes",
        "x-twitter-auth-type": "OAuth2Session",
        "x-twitter-client-language": "en",
        accept: "*/*",
      },
    });
    if (response.status === 401 || response.status === 403) {
      throw new Error("X Cookie 已失效或无权访问");
    }
    if (!response.ok) {
      throw new Error(`X 接口请求失败（${response.status}）`);
    }
    const payload = (await response.json()) as { errors?: Array<{ message?: string }> };
    if (payload.errors?.length) {
      throw new Error(payload.errors[0]?.message || "X 接口返回错误");
    }
    return payload;
  }
}

function readCookie(cookie: string, name: string): string | undefined {
  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return undefined;
}
