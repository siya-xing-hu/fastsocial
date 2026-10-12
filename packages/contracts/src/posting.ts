import twitterText from "twitter-text";
import type { PostingPolicy } from "./assistant.ts";
import type { ParseTweetOptions } from "twitter-text";
// The runtime exports configs; its community typings omit this export.
const defaults = (twitterText as typeof twitterText & { configs: { defaults: ParseTweetOptions } }).configs.defaults;

/** The same counter is used by generation, previews and the final draft-fill check. */
export function measurePost(text: string, maxWeightedLength = 280): { weightedLength: number; valid: boolean } {
  const result = twitterText.parseTweet(text, { ...defaults, maxWeightedTweetLength: maxWeightedLength });
  return { weightedLength: result.weightedLength, valid: result.valid };
}
export function postingPolicy(blueVerified?: boolean): PostingPolicy {
  return {
    maxWeightedLength: blueVerified === true ? 25000 : 280,
    blueVerified: blueVerified ?? null,
    source: blueVerified === true ? "blue-check" : "unconfirmed",
  };
}
export function postingPolicyLabel(policy: PostingPolicy): string {
  if (policy.source === "unconfirmed") return "长文权限未确认，按普通帖子限制";
  if (policy.maxWeightedLength === 280) return "普通帖子";
  return policy.source === "blue-check" ? "已识别蓝标 · 长文" : "长文";
}
