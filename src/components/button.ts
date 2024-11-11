import { createApp, ref } from "vue";
import Button from "./Button.vue";

export interface HandlerParams {
  data: any;
}

export enum ButtonTagEnum {
  TRANSLATE = "translate",
  GENERATE = "generate",
  APPROVAL = "approval",
  DISAPPROVAL = "disapproval",
  SUPPORT = "support",
  JOKE = "joke",
  IDEA = "idea",
  QUESTION = "question",
}

export interface ButtonData {
  disabled: boolean;
  tag: ButtonTagEnum;
  text: string;
  params: HandlerParams;
  handler: (tag: ButtonTagEnum, params: HandlerParams) => void | Promise<void>;
}

export enum ButtonLocationEnum {
  // 上一个
  Previous = "previous",
  // 父级上一个
  ParentPrevious = "parent-previous",
  // 下一个
  Next = "next",
}

export const buttonList = ref<ButtonData[]>([]);

// 创建按钮区域
export function createButtonContainer(
  targetWrapper: HTMLElement,
  buttonLocation: ButtonLocationEnum,
): void {
  targetWrapper.setAttribute("tt-button-is-done", "true");

  const div = document.createElement("div");
  div.style.textOverflow = "unset";
  div.setAttribute("tt-button-is-done", "true");

  // 创建一个 Vue 实例, 同时确保 buttonList 是一个空数组
  buttonList.value = [];
  const app = createApp(Button, {});
  app.mount(div);

  switch (buttonLocation) {
    case ButtonLocationEnum.Previous:
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
    case ButtonLocationEnum.ParentPrevious:
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
    case ButtonLocationEnum.Next:
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
    default:
      targetWrapper.appendChild(div);
      break;
  }
}
