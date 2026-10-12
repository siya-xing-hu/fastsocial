export const SKILL_KEYS = ["summary", "post", "reply"] as const;
export type SkillKey = typeof SKILL_KEYS[number];
export interface AssistantSkill {
  id: string;
  key: SkillKey;
  name: string;
  description: string;
  /** The complete SKILL.md, including its discovery metadata and workflow. */
  instructions: string;
  filePath: string;
  enabled: boolean;
  updatedAt: string;
  revision: string;
  error?: string;
}
export interface WritingPreferences { language: string; voice: string }
export interface PostingPolicy {
  maxWeightedLength: 280 | 25000;
  blueVerified: boolean | null;
  source: "blue-check" | "unconfirmed";
}
export interface DraftValidation {
  policy: PostingPolicy;
  weightedLength: number;
}
export interface PagePost { id: string; author: string; text: string; url: string }
export interface AssistantContext {
  documentId: string;
  url: string;
  title: string;
  account: { actorId: string; username: string; displayName?: string; blueVerified?: boolean };
  selection: string;
  posts: PagePost[];
  target: PagePost | null;
  composer: { id: string; scene: "post" | "reply"; text: string; targetId: string | null } | null;
}
export interface AssistantTurn {
  role: "user" | "assistant";
  content: string;
  skill?: SkillKey;
  /** Frozen page material for this user turn, separate from the user's instructions. */
  reference?: string;
}
export interface AssistantChatRequest {
  skill?: SkillKey;
  previousSkill?: SkillKey;
  input: string;
  history: AssistantTurn[];
  context: AssistantContext;
  targetLanguage: string;
}
export interface AssistantChatResult { skill?: SkillKey; content: string; accountId: string | null; draft?: DraftValidation }

export function assistantPageReference(context: AssistantContext, skill?: SkillKey) {
  return {
    url: context.url, selection: context.selection, target: context.target,
    posts: (!skill || skill === 'summary') && !context.selection && (!context.target || new URL(context.url).pathname.split('/')[3] === context.target.id) ? context.posts : [],
    draft: context.composer?.text ?? '',
  };
}
export interface AssistantCatalog {
  skills: AssistantSkill[];
  account: { id: string; name: string; username: string } | null;
  preferences: WritingPreferences;
}
