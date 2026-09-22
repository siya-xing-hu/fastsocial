import type { Message } from "../common/runtime-message";
import { localServiceClient } from "../background/local-service-client";

export async function execGptPrompt(
  aiProvider: string | undefined,
  messages: Message[],
): Promise<string> {
  return localServiceClient.request<string>("/api/ai/chat", {
    method: "POST",
    body: { provider: aiProvider, messages, stream: false },
  });
}

export async function execGptPromptStream(
  aiProvider: string | undefined,
  messages: Message[],
  onChunk: (chunk: string) => void,
  onError: (error: Error) => void,
  onComplete: () => void,
): Promise<void> {
  try {
    await localServiceClient.streamChat(
      { provider: aiProvider, messages },
      onChunk,
    );
    onComplete();
  } catch (error) {
    onError(error instanceof Error ? error : new Error(String(error)));
  }
}
