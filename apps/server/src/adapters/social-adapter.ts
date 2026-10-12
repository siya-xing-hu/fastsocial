import type { SocialPost, SocialAccount, TimelinePage } from "@fast-social/contracts";

export interface SocialAdapter {
  fetchAccount?(username: string, cookieId?: string): Promise<SocialAccount>;
  fetchTimelinePage?(account: SocialAccount, cursor?: string, surface?: "posts" | "replies", cookieId?: string): Promise<TimelinePage>;
  fetchRecentPosts(username: string, cookieId?: string): Promise<SocialPost[]>;
}
