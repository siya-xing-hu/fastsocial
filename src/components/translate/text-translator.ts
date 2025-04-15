/**
 * @fileoverview 文本翻译功能模块
 */

import { isContent, randomString } from "../../utils/kit";
import { createApp } from "vue";
import Translate from "./Translate.vue";
import {
  RuntimeMessageTypeEnum,
  sendRuntimeMessage,
  TranslateRuntimeMessage,
} from "../../common/runtime-message";
import { log, log_error } from "../../common/logging";

interface TranslateData {
  id?: string;
  text: string;
  show: boolean;
}

const translateDataList: TranslateData[] = [];

/**
 * 翻译文本内容
 * @param text 要翻译的文本
 * @returns 翻译后的文本
 */
export async function translateContent(text: string): Promise<string> {
  const message: TranslateRuntimeMessage = {
    type: RuntimeMessageTypeEnum.TRANSLATE,
    data: {
      content: text,
    },
  };

  const response = await sendRuntimeMessage(message);
  if (!response.is_ok) {
    log_error("AI generate failed", response.error);
    return "";
  }
  return response.data;
}

/**
 * 执行普通网页的翻译操作
 * @param clientX 鼠标X坐标
 * @param clientY 鼠标Y坐标
 */
export async function execTranslate(
  clientX: number,
  clientY: number,
): Promise<void> {
  const targetDiv = findNearestDivAndText(clientX, clientY);

  if (targetDiv) {
    // 如果是翻译元素，直接隐藏翻译元素 text-is-translate-text
    if (targetDiv.getAttribute("text-is-translate-text")) {
      const translateId = targetDiv.getAttribute("text-is-translate-text");
      const translateData = translateDataList.find(
        (item) => item.id === translateId,
      );
      if (translateData) {
        if (translateData.show) {
          translateData.show = false;
          // 直接删除当前的 targetDiv
          targetDiv.remove();
        } else {
          translateData.show = true;
          // 显示翻译元素
          createContainer(targetDiv, {
            id: translateData.id,
            text: translateData.text,
            show: true,
          });
        }
      }
      return;
    }

    // 判断是否已经翻译
    if (targetDiv.getAttribute("text-is-translated")) {
      const translateId = targetDiv.getAttribute("text-is-translated");
      const translateData = translateDataList.find(
        (item) => item.id === translateId,
      );
      if (translateData) {
        if (translateData.show) {
          translateData.show = false;
          // 删除翻译元素
          const translateElement = document.querySelector(
            `[text-is-translate-text="${translateId}"]`,
          );
          translateElement && translateElement.remove();
        } else {
          translateData.show = true;
          // 显示翻译元素
          createContainer(targetDiv, {
            id: translateData.id,
            text: translateData.text,
            show: true,
          });
        }
      }
    } else {
      // 翻译
      const textContent = targetDiv.textContent;
      if (!textContent || !isContent(textContent)) {
        return;
      }
      const translatedText = await translateContent(textContent);
      if (!translatedText) {
        log("No translated text.");
        return;
      }
      createContainer(targetDiv, {
        text: translatedText,
        show: true,
      });
    }
  }
}

/**
 * 执行Notion页面的翻译操作
 * @param clientX 鼠标X坐标
 * @param clientY 鼠标Y坐标
 */
export async function execNotionTranslate(
  clientX: number,
  clientY: number,
): Promise<void> {
  const targetDiv = findNearestDivAndText(clientX, clientY);

  if (targetDiv) {
    // 翻译
    const textContent = targetDiv.textContent;
    if (!textContent || !isContent(textContent)) {
      log("textContent: ", textContent);
      return;
    }
    if (textContent.includes("\u200D\n")) {
      targetDiv.textContent = textContent.split("\u200D\n")[0];
      return;
    }
    const translatedText = await translateContent(textContent);
    if (!translatedText) {
      log("No translated text.");
      return;
    }

    targetDiv.textContent = textContent + "\u200D\n" + translatedText;
  }
}

/**
 * 查找最近的文本元素
 * @param clientX 鼠标X坐标
 * @param clientY 鼠标Y坐标
 * @returns 找到的HTML元素或null
 */
function findNearestDivAndText(
  clientX: number,
  clientY: number,
): HTMLElement | null {
  const targetElement: HTMLElement | null = document.elementFromPoint(
    clientX,
    clientY,
  ) as HTMLElement;

  let targetDiv: HTMLElement | null = null;

  // Traverse parent chain to find the nearest bottom-level div
  if (targetElement) {
    for (
      let element: HTMLElement | null = targetElement;
      element;
      element = element.parentElement
    ) {
      // 如果是 div 元素、 H 元素、span 元素、p 元素、a 元素
      if (
        element.tagName === "DIV" || element.tagName.match(/H\d/) ||
        element.tagName === "SPAN" || element.tagName === "P" ||
        element.tagName === "A"
      ) {
        targetDiv = element as HTMLElement;
        break;
      }
    }
  }

  return targetDiv;
}

/**
 * 创建翻译容器
 * @param targetDiv 目标元素
 * @param translateData 翻译数据
 */
function createContainer(
  targetDiv: HTMLElement,
  translateData: TranslateData,
): void {
  if (!translateData.id) {
    // 生成一个 uuid
    translateData.id = randomString(10);
    translateDataList.push(translateData);
  }

  const div = document.createElement("div");

  div.setAttribute("text-is-translate-text", translateData.id);
  div.style.textOverflow = "unset";

  const app = createApp(Translate, {
    translatedText: translateData.text,
  });
  app.mount(div);

  // 获取 tweetWrapper 的父元素
  const parentElement = targetDiv.parentNode;
  // 确保存在父元素
  if (parentElement) {
    // 将新创建的容器添加到父元素中
    parentElement.insertBefore(div, targetDiv.nextSibling);
  } else {
    targetDiv.appendChild(div);
  }
  targetDiv.setAttribute("text-is-translated", translateData.id);
} 