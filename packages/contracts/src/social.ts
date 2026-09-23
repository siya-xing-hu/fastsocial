export type SocialPlatform = "x";

export interface SocialPost {
  id: string;
  platform: SocialPlatform;
  author: string;
  text: string;
  createdAt: string;
  url: string;
  quotedText?: string;
  replyToId?: string;
  quotedPostId?: string;
  type: "post" | "reply" | "repost";
}
