import type { SocialPost, SocialAccount, TimelinePage } from "@fast-social/contracts";

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
  const userCore = asObject(userResult?.core);
  const id = asString(tweet.rest_id) ?? asString(legacy?.id_str);
  const author = asString(userCore?.screen_name) ?? asString(userLegacy?.screen_name);
  const text = extractText(tweet, legacy);
  const createdAt = asString(legacy?.created_at);
  if (!id || !author || !text || !createdAt) return null;

  const repost = unwrapTweet(asObject(legacy?.retweeted_status_result)?.result);
  const quote = unwrapTweet(asObject(tweet.quoted_status_result ?? legacy?.quoted_status_result)?.result);
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
    ...(reply ? { replyToId: asString(legacy?.in_reply_to_status_id_str) } : {}),
    ...(quote?.rest_id ? { quotedPostId: asString(quote.rest_id) } : {}),
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

export function parseXAccount(payload: unknown, username: string): SocialAccount {
  const user = asObject(getPath(payload, ['data', 'user', 'result']));
  const legacy = asObject(user?.legacy);
  const core = asObject(user?.core);
  return {
    id: parseXUserId(payload),
    username: asString(core?.screen_name) ?? asString(legacy?.screen_name) ?? username,
    name: asString(core?.name) ?? asString(legacy?.name) ?? username,
    bio: asString(asObject(user?.profile_bio)?.description) ?? asString(legacy?.description) ?? '',
    fetchedAt: new Date().toISOString(),
  };
}

export function parseXTimelinePage(payload: unknown, username: string): TimelinePage {
  const instructions = getPath(payload, ['data', 'user', 'result', 'timeline', 'timeline', 'instructions'])
    ?? getPath(payload, ['data', 'user', 'result', 'timeline_v2', 'timeline', 'instructions']);
  if (!Array.isArray(instructions)) throw new Error('X 时间线结构已变化，无法确认分页完整性');
  let nextCursor: string | null = null;
  const entries: unknown[] = [];
  for (const instruction of instructions) {
    const object = asObject(instruction);
    // Pinned and promoted entries are not part of the chronological window.
    if (object?.type === 'TimelinePinEntry') continue;
    if (Array.isArray(object?.entries)) entries.push(...object.entries);
    if (object?.entry) entries.push(object.entry);
  }
  walk(entries, candidate => {
    if (candidate.cursorType === 'Bottom' && typeof candidate.value === 'string') nextCursor = candidate.value;
  });
  return { posts: parseXTimeline(entries).filter(post => post.author.toLowerCase() === username.toLowerCase()), nextCursor };
}
