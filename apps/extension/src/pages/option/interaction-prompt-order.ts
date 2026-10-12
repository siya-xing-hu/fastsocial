import type { InteractionPrompt } from "@fast-social/contracts";

export type PromptOrderAction = "down" | "top";

/** Reorder one scene while preserving every slot and item in the other scene. */
export function reorderInteractionPrompts(
  prompts: InteractionPrompt[],
  id: string,
  action: PromptOrderAction,
): InteractionPrompt[] {
  const prompt = prompts.find((item) => item.id === id);
  if (!prompt) return prompts;

  const scenePrompts = prompts.filter((item) => item.scene === prompt.scene);
  const index = scenePrompts.findIndex((item) => item.id === id);
  const targetIndex = action === "top" ? 0 : index + 1;
  if (targetIndex < 0 || targetIndex >= scenePrompts.length || targetIndex === index) {
    return prompts;
  }

  scenePrompts.splice(index, 1);
  scenePrompts.splice(targetIndex, 0, prompt);
  let sceneIndex = 0;
  return prompts.map((item) => item.scene === prompt.scene ? scenePrompts[sceneIndex++] : item);
}
