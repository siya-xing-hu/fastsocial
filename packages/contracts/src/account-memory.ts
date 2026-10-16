import type { SocialPost } from './social.ts';

export interface SocialAccount {
  id: string;
  username: string;
  name: string;
  bio: string;
  fetchedAt: string;
  blueVerified?: boolean;
}
export interface TimelinePage {
  posts: SocialPost[];
  nextCursor: string | null;
  /** Chronological top-level posts, excluding pinned/promoted/conversation context. */
  boundaryPostIds?: string[];
}
export type MemorySection = 'background' | 'topics' | 'language' | 'recent';
export interface MemoryFact {
  text: string;
  evidenceIds: string[];
  kind: 'explicit' | 'inferred' | 'manual';
  updatedAt: string;
}
export type AccountMemory = Partial<Record<MemorySection, MemoryFact>>;
export interface AccountProfile {
  account: SocialAccount;
  memory: AccountMemory;
  /** Exact manually edited text; AI rebuilds replace it with structured memory. */
  portraitText?: string;
  /** Posts used to generate the portrait, preserved through manual edits and clearing. */
  evidenceIds?: string[];
  version: number;
  initialized: boolean;
  bioSource?: string;
  updatedAt: string;
}
export interface PostDecision {
  postId: string;
  ruleId: string;
  status: 'match' | 'no_match' | 'uncertain';
  reason: string;
  evidenceIds: string[];
  eventTime?: string;
}
export interface MonitorBatchStatus {
  baselinePending?: boolean;
  fetched: number;
  analyzed: number;
  matched: number;
  uncertain: number;
  pending: number;
  phase: 'fetch' | 'learn' | 'analyze' | 'notify' | 'done';
  error: string | null;
  checkedAt: string;
}
export interface AccountProfileView {
  profile: AccountProfile | null;
  evidence: SocialPost[];
  status: MonitorBatchStatus | null;
}
