import type { InteractionPrompt } from "./ai.ts";
import type { XCookieStatus } from "./settings.ts";
import type { SocialPost } from "./social.ts";
import type { WritingPreferences } from "./assistant.ts";

export const ACCOUNT_REQUEST_ACTIONS = ['home', 'profile', 'posts', 'follow', 'unfollow', 'reply'] as const;
export type AccountRequestAction = typeof ACCOUNT_REQUEST_ACTIONS[number];
export type AccountDailyLimits = Record<AccountRequestAction, number>;
export const ACCOUNT_REQUEST_LABELS: Record<AccountRequestAction, string> = {
  home: '抓取首页', profile: '读取用户 Profile', posts: '抓取用户 Post', follow: '关注作者', unfollow: '取消关注', reply: '回复 Post',
};
export const DEFAULT_ACCOUNT_DAILY_LIMITS: AccountDailyLimits = { home: 100, profile: 100, posts: 200, follow: 20, unfollow: 20, reply: 20 };
export interface AccountRequestUsage {
  limits: AccountDailyLimits;
  used: AccountDailyLimits;
  day: string;
  resetsAt: string;
}

export interface ManagedAccountProfile {
  primaryLanguage: string;
  /** Identity, audience, habits and boundaries, written as a cohesive account profile. */
  description: string;
}

export interface ManagedAccount {
  id: string;
  name: string;
  platform: "x";
  username: string;
  actorId: string;
  cookieConfigured: boolean;
  status: XCookieStatus;
  autoTranslate: boolean;
  profile: ManagedAccountProfile;
  configIds: string[];
  assistant?: WritingPreferences;
  dailyLimits?: AccountDailyLimits;
}
export interface AccountInput {
  name: string;
  username: string;
  /** Omitted on edit to retain the stored secret. */
  cookie?: string;
  configIds?: string[];
  autoTranslate?: boolean;
  profile?: ManagedAccountProfile;
  assistant?: WritingPreferences;
  dailyLimits?: AccountDailyLimits;
}
export interface AccountConfiguration {
  accountId: string | null;
  autoTranslate: boolean;
  prompts: InteractionPrompt[];
}
export interface AccountHomeTestResult {
  accountId: string;
  posts: SocialPost[];
}
export interface PromptInput {
  name: string;
  scene: "post" | "reply";
  prompt: string;
  accountIds: string[];
}

/** Replace tokens in one pass so user text is never interpreted as a template. */
export function renderPrompt(
  template: string,
  values: { input: string; reply?: string; targetLanguage: string }
): string {
  return template.replace(/\{\{_tl_\}\}|\{input\}|\{reply\}/g, (token) =>
    token === "{input}"
      ? values.input
      : token === "{reply}"
      ? values.reply ?? ""
      : values.targetLanguage
  );
}
