/**
 * @fileoverview 文本翻译功能模块
 */

import { isContent, randomString } from "../../utils/kit";
import { createApp } from "vue";
import Translate from "../ui/Translate.vue";
import {
  RuntimeMessageTypeEnum,
  sendRuntimeMessage,
  TranslateRuntimeMessage,
} from "../../common/runtime-message";
import { log, log_error } from "../../common/logging";
import { config, TranslateChannelEnum } from "../../common/storage-config";

/**
 * 翻译文本内容
 * @param text 要翻译的文本
 * @returns 翻译后的文本
 */
export async function translateContent(channel: TranslateChannelEnum, text: string, isAdvanced: boolean): Promise<string> {
  const message: TranslateRuntimeMessage = {
    type: RuntimeMessageTypeEnum.TRANSLATE,
    data: {
      channel: channel,
      content: text,
      is_advanced: isAdvanced,
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
  isAdvanced: boolean,
): Promise<void> {
  const targetDiv = findNearestDivAndText(clientX, clientY);
  if (!targetDiv) return;

  // 处理翻译元素点击
  if (targetDiv.getAttribute("text-is-translate-text") || targetDiv.getAttribute("text-is-translate-text-advanced")) {
    // 直接切换显示状态
    const isVisible = targetDiv.style.display !== "none";
    targetDiv.style.display = isVisible ? "none" : "block";
    return;
  }

  // 处理已翻译元素的点击
  if (isAdvanced && targetDiv.getAttribute("text-is-translated-advanced")) {
    const translateId = targetDiv.getAttribute("text-is-translated-advanced");
    const translateElement = document.querySelector(
      `[text-is-translate-text-advanced="${translateId}"]`
    ) as HTMLElement;
    
    if (translateElement) {
      // 直接切换显示状态
      const isVisible = translateElement.style.display !== "none";
      translateElement.style.display = isVisible ? "none" : "block";
    }
    return;
  }
  if (!isAdvanced && targetDiv.getAttribute("text-is-translated")) {
    const translateId = targetDiv.getAttribute("text-is-translated");
    const translateElement = document.querySelector(
      `[text-is-translate-text="${translateId}"]`
    ) as HTMLElement;
    if (translateElement) {
      // 直接切换显示状态
      const isVisible = translateElement.style.display !== "none";
      translateElement.style.display = isVisible ? "none" : "block";
    }
    return;
  }

  // 处理新文本翻译
  const textContent = targetDiv.textContent;
  if (!textContent || !isContent(textContent)) return;
  
  log("开始翻译", textContent);
  const translatedText = await translateContent(config.value.basic.translateProvider, textContent, isAdvanced);
  if (!translatedText) {
    log("No translated text.");
    return;
  }
  
  createContainer(targetDiv, translatedText, isAdvanced);
}

/**
 * 执行Notion页面的翻译操作
 * @param clientX 鼠标X坐标
 * @param clientY 鼠标Y坐标
 */
export async function execNotionTranslate(
  clientX: number,
  clientY: number,
  isAdvanced: boolean,
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
    const translatedText = await translateContent(config.value.basic.translateProvider, textContent, isAdvanced);
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

  // 遍历父元素链查找最近的 div
  if (targetElement) {
    for (
      let element: HTMLElement | null = targetElement;
      element;
      element = element.parentElement
    ) {
      if (element.tagName === 'DIV') {
        targetDiv = element;
        break;
      }
    }
  }

  // 如果 targetDiv 不为空，检查是否是翻译组件
  if (targetDiv) {
    // 检查当前元素及其最多三层父级元素是否是翻译组件
    let element: HTMLElement | null = targetDiv;
    let depth = 0;
    
    while (element && depth < 4) {
      if (element.getAttribute("text-is-translate-text") || element.getAttribute("text-is-translate-text-advanced")) {
        return element;
      }
      element = element.parentElement;
      depth++;
    }
  }

  return targetDiv;
}

/**
 * 创建翻译容器
 * @param targetDiv 目标元素
 * @param translatedText 翻译后的文本
 */
function createContainer(
  targetDiv: HTMLElement,
  translatedText: string,
  isAdvanced: boolean,
): void {
  // 生成一个唯一ID
  const translateId = randomString(10);

  // 创建新的翻译元素
  const div = document.createElement("div");
  div.setAttribute(isAdvanced? "text-is-translate-text-advanced" : "text-is-translate-text", translateId);
  div.style.textOverflow = "unset";
  div.style.display = "block"; // 默认显示

  const app = createApp(Translate, {
    translatedText: translatedText,
  });
  app.mount(div);

  // 将翻译元素插入到目标元素后面
  targetDiv.parentNode?.insertBefore(div, targetDiv.nextSibling);
  targetDiv.setAttribute(isAdvanced? "text-is-translated-advanced" : "text-is-translated", translateId);
} 