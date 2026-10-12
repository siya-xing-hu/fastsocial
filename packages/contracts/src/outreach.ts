export interface OutreachConfig {
  id: string;
  name: string;
  enabled: boolean;
  cookieId: string;
  actorId: string;
  prompt: string;
  intervalMinutes: number;
  dailyLimit: number;
  requestGapSeconds: number;
  replyText: string;
}
export type OutreachConfigInput = Omit<OutreachConfig, 'actorId' | 'id'>;
export type OutreachStage = 'pending_follow' | 'following' | 'pending_reply' | 'replying' | 'done' | 'failed' | 'uncertain' | 'skipped';
export interface OutreachRecord {
  id: string;
  actorId: string;
  userId: string;
  username: string;
  name: string;
  postId: string;
  postText: string;
  postCreatedAt: string;
  reason: string;
  replyText: string;
  stage: OutreachStage;
  following: boolean;
  followedBy: boolean | null;
  createdAt: string;
  followAttemptAt: string | null;
  followedAt: string | null;
  repliedAt: string | null;
  replyId: string | null;
  autoCheckAttemptAt: string | null;
  lastCheckAttemptAt: string | null;
  lastCheckedAt: string | null;
  checkState: 'idle' | 'checking' | 'error';
  actionError: string | null;
  checkError: string | null;
}
export interface OutreachCheckJob {
  actorId: string;
  ids: string[];
  completed: number;
  status: 'running' | 'done' | 'stopped';
}
export interface OutreachState {
  nextRequestAt: string | null;
  lastFetchedAt: string | null;
  pauseReason: string | null;
  checkJob: OutreachCheckJob | null;
}
export interface OutreachView {
  config: OutreachConfig;
  state: OutreachState;
  records: OutreachRecord[];
  todayFollowAttempts: number;
}
export interface OutreachAccountSummary {
  config: OutreachConfig;
  state: OutreachState;
  recordCount: number;
  mutualCount: number;
  todayFollowAttempts: number;
}
export interface OutreachAccountsView {
  accounts: OutreachAccountSummary[];
  defaults: OutreachConfigInput;
}
