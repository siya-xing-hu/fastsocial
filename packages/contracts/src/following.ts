import type { SocialAccount } from './account-memory.ts';

export interface FollowingEntry {
  id: string;
  actorId: string;
  user: SocialAccount;
  status: 'following' | 'not_following' | 'pending' | 'uncertain';
  followedBy: boolean | null;
  source: 'workflow' | 'manual' | 'history';
  followedAt: string | null;
  checkedAt: string | null;
  updatedAt: string;
  error: string | null;
  summary: string;
  summaryStatus: 'pending' | 'running' | 'done' | 'failed';
  summaryError: string | null;
  summaryUpdatedAt: string | null;
}
export interface XProfileRelationship {
  account: SocialAccount;
  following: boolean;
  followedBy: boolean | null;
}
