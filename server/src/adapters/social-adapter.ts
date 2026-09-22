import type { SocialPost } from "@fast-social/contracts";

export interface SocialAdapter {
  fetchRecentPosts(username: string): Promise<SocialPost[]>;
}
