import { createApp, ref } from "vue";
import Prompt from "./Prompt.vue";
import { PromptConfig } from '../../common/storage-config';

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

export const promptList = ref<PromptData[]>([]);

// 创建按钮区域
export function createPromptContainer(
  targetWrapper: HTMLElement,
  promptLocation: PromptLocationEnum,
): void {
  targetWrapper.setAttribute("tt-prompt-is-done", "true");

  const div = document.createElement("div");
  div.style.textOverflow = "unset";
  div.setAttribute("tt-prompt-is-done", "true");

  // 创建一个 Vue 实例, 同时确保 promptList 是一个空数组
  promptList.value = [];
  const app = createApp(Prompt, {
    promptList: promptList.value  // 将 promptList 通过 props 传递给组件
  });
  
  app.mount(div);

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
}
