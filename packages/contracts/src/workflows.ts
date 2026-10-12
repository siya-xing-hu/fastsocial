import type { SocialPost } from "./social.ts";
export const RANDOM_WORKFLOW_ACCOUNT = "random";
export type WorkflowAction =
  | { type: "follow" }
  | { type: "reply"; mode: "text"; text: string }
  | { type: "reply"; mode: "skill"; elements?: string; /** Legacy fields retained for existing rules. */ instructions?: string; input?: string; targetLanguage?: string }
  | {
      type: "reply";
      mode: "prompt";
      promptId: string;
      input: string;
      targetLanguage: string;
    }
  | { type: "notify"; content: string };
export interface WorkflowInput {
  name: string;
  accountId: string;
  source: "user" | "home";
  usernames: string[];
  condition: string;
  intervalMinutes: number;
  enabled: boolean;
  actions: WorkflowAction[];
}
export interface Workflow extends WorkflowInput {
  id: string;
  createdAt: string;
  lastCheckedAt: string | null;
  lastError: string | null;
  lastSeenPostId?: string | null;
  retryAt?: string | null;
}
export interface WorkflowRecord {
  id: string;
  workflowId: string;
  accountId?: string;
  accountName?: string;
  post: SocialPost;
  reason: string;
  status: "running" | "done" | "failed" | "uncertain" | "pending" | "skipped";
  resume?: { configuration: string; userId: string; following: boolean | null };
  actions: Array<{
    type: WorkflowAction["type"];
    status: "pending" | "running" | "done" | "failed" | "uncertain" | "skipped";
    result?: string;
    newlyFollowed?: boolean;
  }>;
  createdAt: string;
}
export interface WorkflowPreview {
  post: SocialPost;
  matched: boolean;
  reason: string;
}
export interface WorkflowRun {
  id: string;
  workflowId: string;
  accountId?: string;
  accountName?: string;
  status: "running" | "done" | "failed" | "cancelled" | "limited";
  phase?: "fetch" | "analyze" | "learn" | "review" | "actions";
  batch?: { index: number; total: number; checked: number; matched: number; completed: number };
  /** Unique posts inspected this run, including posts excluded before AI evaluation. */
  scanned: number;
  /** Validated AI matches, independent of whether an action was eligible or successful. */
  aiMatched: number;
  checked: number;
  /** Action-qualified matches: requires a confirmed new follow in follow workflows. */
  matched: number;
  completed: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export function replyElements(action: Extract<WorkflowAction, { mode: "skill" }>): string {
  return action.elements ?? [action.instructions, action.input].filter(Boolean).join("\n\n");
}
