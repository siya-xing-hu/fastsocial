import type { SocialPost } from "@fast-social/contracts";

type JsonObject = Record<string, unknown>;

export function parseXUserId(payload: unknown): string {
  const data = asObject(payload);
  const user = getPath(data, ["data", "user", "result"]);
  const id = asString(asObject(user)?.rest_id);
  if (!id) throw new Error("X 用户响应结构已变化，无法解析用户 ID");
  return id;
}

export function parseXTimeline(payload: unknown): SocialPost[] {
  const results: SocialPost[] = [];
  const seen = new Set<string>();
  walk(payload, (candidate) => {
    const tweet = unwrapTweet(asObject(candidate.tweet_results)?.result);
    if (!tweet) return;
    const post = mapTweet(tweet);
    if (!post || seen.has(post.id)) return;
    seen.add(post.id);
    results.push(post);
  });
  return results;
}

function mapTweet(tweet: JsonObject): SocialPost | null {
  const legacy = asObject(tweet.legacy);
  const core = asObject(tweet.core);
  const userResult = asObject(asObject(core?.user_results)?.result);
  const userLegacy = asObject(userResult?.legacy);
  const id = asString(tweet.rest_id) ?? asString(legacy?.id_str);
  const author = asString(userLegacy?.screen_name);
  const text = extractText(tweet, legacy);
  const createdAt = asString(legacy?.created_at);
  if (!id || !author || !text || !createdAt) return null;

  const repost = unwrapTweet(asObject(legacy?.retweeted_status_result)?.result);
  const quote = unwrapTweet(asObject(legacy?.quoted_status_result)?.result);
  const reply = Boolean(asString(legacy?.in_reply_to_status_id_str));
  return {
    id,
    platform: "x",
    author,
    text: repost ? extractText(repost, asObject(repost.legacy)) ?? text : text,
    createdAt: normalizeDate(createdAt),
    url: `https://x.com/${author}/status/${id}`,
    ...(quote
      ? { quotedText: extractText(quote, asObject(quote.legacy)) ?? undefined }
      : {}),
    type: repost ? "repost" : reply ? "reply" : "post",
  };
}

function extractText(tweet: JsonObject, legacy: JsonObject | undefined): string | null {
  const noteResult = asObject(asObject(asObject(tweet.note_tweet)?.note_tweet_results)?.result);
  return asString(noteResult?.text) ?? asString(legacy?.full_text) ?? null;
}

function unwrapTweet(value: unknown): JsonObject | null {
  const object = asObject(value);
  if (!object) return null;
  if (object.__typename === "TweetWithVisibilityResults") {
    return unwrapTweet(object.tweet);
  }
  if (object.__typename === "Tweet" || (object.rest_id && object.legacy)) {
    return object;
  }
  const result = asObject(asObject(object.tweet_results)?.result);
  return result ? unwrapTweet(result) : null;
}

function walk(value: unknown, visit: (value: JsonObject) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
    return;
  }
  const object = asObject(value);
  if (!object) return;
  visit(object);
  for (const child of Object.values(object)) walk(child, visit);
}

function getPath(value: unknown, path: string[]): unknown {
  let current: unknown = value;
  for (const key of path) current = asObject(current)?.[key];
  return current;
}

function normalizeDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}
