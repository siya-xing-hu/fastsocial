import type { SocialPost, SocialAccount, TimelinePage } from "@fast-social/contracts";

export interface SocialAdapter {
  fetchAccount?(username: string): Promise<SocialAccount>;
  fetchTimelinePage?(account: SocialAccount, cursor?: string, surface?: "posts" | "replies"): Promise<TimelinePage>;
  fetchRecentPosts(username: string, cookieId?: string): Promise<SocialPost[]>;
}
