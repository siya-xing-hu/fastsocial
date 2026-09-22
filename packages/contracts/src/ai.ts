export type ThinkingType = "enabled" | "disabled" | "auto";

export interface AIModelConfig {
  name: string;
  thinking?: { type: ThinkingType };
}

export interface AIServiceConfig {
  id: string;
  name: string;
  endpoint: string;
  apiKey?: string;
  apiKeyConfigured?: boolean;
  models: AIModelConfig[];
  enabled: boolean;
}

export interface InteractionPrompt {
  id: string;
  name: string;
  scene: "post" | "reply";
  prompt: string;
  enabled: boolean;
}

export interface AIMatchResult {
  matched: boolean;
  message: string;
}

export interface AIChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface AIChatRequest {
  provider?: string;
  messages: AIChatMessage[];
  stream?: boolean;
}
