import type { AccountMemory, MonitorBatchStatus, PostDecision } from './account-memory.ts';
import type { AIMatchResult } from "./ai.ts";
import type { SocialPlatform, SocialPost } from "./social.ts";

export interface Monitor {
  id: string;
  name: string;
  platform: SocialPlatform;
  username: string;
  prompt: string;
  intervalMinutes: number;
  enabled: boolean;
  lastSeenPostId: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  batchStatus?: MonitorBatchStatus | null;
}

export interface CreateMonitorInput {
  name: string;
  platform?: SocialPlatform;
  username: string;
  prompt: string;
  intervalMinutes: number;
  enabled?: boolean;
}

export type UpdateMonitorInput = Partial<CreateMonitorInput>;

export interface MonitorTestResult {
  post: SocialPost;
  evaluation: AIMatchResult;
  posts: SocialPost[];
  decisions: PostDecision[];
  memory: AccountMemory;
  profileVersion: number;
  cached: boolean;
}
