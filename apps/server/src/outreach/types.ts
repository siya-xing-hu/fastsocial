import type { SocialPost } from '@fast-social/contracts';

export interface OutreachPost {
  post: SocialPost;
  userId: string;
  name: string;
  following: boolean | null;
  followedBy: boolean | null;
}
export interface OutreachIdentity { cookieId: string; actorId: string }
export interface OutreachRelationship { following: boolean; followedBy: boolean }
export interface OutreachFollowResult {
  following: boolean;
  followedBy: boolean | null;
  /** False when the tracked service skipped a write; raw adapters perform a write. */
  created?: boolean;
  skipReason?: string;
}
export interface OutreachAdapter {
  identity(cookieId: string): OutreachIdentity;
  home(identity: OutreachIdentity, seenPostIds: string[]): Promise<OutreachPost[]>;
  follow(identity: OutreachIdentity, userId: string, username?: string): Promise<OutreachFollowResult>;
  followSkipReason?(identity: OutreachIdentity, userId: string, username: string, continuingNewFollow?: boolean): string | null;
  reply(identity: OutreachIdentity, postId: string, text: string): Promise<string>;
  relationship(identity: OutreachIdentity, userId: string, username?: string): Promise<OutreachRelationship>;
}
export interface OutreachDecision { postId: string; status: 'match' | 'no_match' | 'uncertain'; reason: string }
export interface OutreachClassifier { classify(posts: OutreachPost[], prompt: string): Promise<OutreachDecision[]> }
