import { createApp } from "vue";
import Prompt from "./Prompt.vue";
import type { PromptConfig } from "../../common/storage-config";

export interface HandlerParams {
  data: any;
}

export interface PromptData extends PromptConfig {
  handler: (prompt: PromptConfig, params: HandlerParams) => void | Promise<void>;
  params: HandlerParams;
}

export enum PromptLocationEnum {
  // 上一个
  Previous = "previous",
  // 父级上一个
  ParentPrevious = "parent-previous",
  // 下一个
  Next = "next",
  // 父级下一个
  ParentNext = "parent-next",
  // 内部
  Inside = "inside",
}

interface PromptMount {
  app: ReturnType<typeof createApp>;
  targetWrapper: HTMLElement;
}

const promptApps = new Map<HTMLElement, PromptMount>();
let promptLifecycleObserver: MutationObserver | null = null;

function disconnectLifecycleObserverWhenIdle(): void {
  if (promptApps.size > 0) return;
  promptLifecycleObserver?.disconnect();
  promptLifecycleObserver = null;
}

function cleanupPromptMount(container: HTMLElement, removeContainer: boolean): void {
  const mount = promptApps.get(container);
  if (!mount) return;

  // Delete first: Vue unmount removes Teleport nodes and causes more DOM mutations.
  promptApps.delete(container);
  mount.app.unmount();
  if (removeContainer && container.isConnected) container.remove();

  const targetStillHasMount = [...promptApps.values()].some(
    (entry) => entry.targetWrapper === mount.targetWrapper,
  );
  if (!targetStillHasMount) {
    mount.targetWrapper.removeAttribute("tt-prompt-is-done");
  }

  disconnectLifecycleObserverWhenIdle();
}

function cleanupDisconnectedPromptMounts(): void {
  for (const [container, mount] of promptApps) {
    if (!container.isConnected || !mount.targetWrapper.isConnected) {
      cleanupPromptMount(container, container.isConnected);
    }
  }
}

function ensureLifecycleObserver(): void {
  if (promptLifecycleObserver || !document.body) return;
  promptLifecycleObserver = new MutationObserver(cleanupDisconnectedPromptMounts);
  promptLifecycleObserver.observe(document.body, { childList: true, subtree: true });
}

// 创建按钮区域
export function createPromptContainer(
  targetWrapper: HTMLElement,
  promptLocation: PromptLocationEnum,
  prompts: PromptData[],
): boolean {
  cleanupDisconnectedPromptMounts();
  const existingMount = [...promptApps.entries()].find(
    ([container, mount]) => mount.targetWrapper === targetWrapper && container.isConnected,
  );
  if (existingMount) return false;

  // A marker can outlive its container for one MutationObserver tick. Treat it as stale.
  targetWrapper.removeAttribute("tt-prompt-is-done");
  targetWrapper.setAttribute("tt-prompt-is-done", "true");

  const div = document.createElement("div");
  div.style.textOverflow = "unset";
  div.setAttribute("tt-prompt-is-done", "true");
  div.setAttribute("data-fast-social-prompt-container", "true");

  const app = createApp(Prompt, {
    promptList: prompts,
  });

  switch (promptLocation) {
    case PromptLocationEnum.Previous:
      // 获取 tweetWrapper 的父元素
      const parentElement = targetWrapper.parentNode;
      // 确保存在父元素
      if (parentElement) {
        // 将新创建的容器添加到父元素中
        parentElement.insertBefore(div, targetWrapper);
      } else {
        targetWrapper.appendChild(div);
      }
      break;
    case PromptLocationEnum.ParentPrevious:
      // 获取 tweetWrapper 的父元素
      const parentParentElement = targetWrapper.parentNode?.parentNode;
      // 确保存在父元素的父元素
      if (parentParentElement) {
        // 将新创建的容器添加到父元素的父元素中
        parentParentElement.insertBefore(div, targetWrapper.parentNode);
      } else {
        targetWrapper.appendChild(div);
      }
      break;
    case PromptLocationEnum.Next:
      // 获取 tweetWrapper 的下一个兄弟元素
      const nextElement = targetWrapper.nextElementSibling;
      // 确保存在下一个兄弟元素
      if (nextElement) {
        // 将新创建的容器添加到下一个兄弟元素之前
        targetWrapper.parentElement?.insertBefore(div, nextElement);
      } else {
        targetWrapper.parentElement?.appendChild(div);
      }
      break;
    case PromptLocationEnum.ParentNext:
      // 获取 tweetWrapper 的父元素
      const parentNextElement = targetWrapper.parentNode?.parentNode;
      // 确保存在父元素的父元素
      if (parentNextElement) {
        // 将新创建的容器添加到父元素的父元素中
        parentNextElement.insertBefore(div, targetWrapper.parentNode);
      } else {
        targetWrapper.appendChild(div);
      }
      break;
    case PromptLocationEnum.Inside:
      // 将新创建的容器添加到 tweetWrapper 内部
      targetWrapper.appendChild(div);
      break;
    default:
      targetWrapper.appendChild(div);
      break;
  }

  try {
    app.mount(div);
    promptApps.set(div, { app, targetWrapper });
    ensureLifecycleObserver();
    return true;
  } catch (error) {
    targetWrapper.removeAttribute("tt-prompt-is-done");
    div.remove();
    throw error;
  }
}

export function resetPromptContainers(): void {
  promptLifecycleObserver?.disconnect();
  promptLifecycleObserver = null;

  for (const element of [...promptApps.keys()]) {
    cleanupPromptMount(element, true);
  }
  document
    .querySelectorAll('[data-fast-social-prompt-container="true"]')
    .forEach((element) => element.remove());
  document
    .querySelectorAll('[tt-prompt-is-done="true"]')
    .forEach((element) => element.removeAttribute("tt-prompt-is-done"));
}
