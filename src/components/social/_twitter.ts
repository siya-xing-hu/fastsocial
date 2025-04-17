import { log, log_error } from "../../common/logging";
import {
  AIGenarateRuntimeMessage,
  RuntimeMessageTypeEnum,
  sendRuntimeMessage,
} from "../../common/runtime-message";
import {
  ButtonConfig,
  config,
  TranslateChannelEnum,
} from "../../common/storage-config";
import { setInputText } from "../../utils/kit";
import { execObserver } from "../../utils/mutationObserver";
import { translateContent } from "../translate/text-translator";
import {
  buttonList,
  ButtonLocationEnum,
  createButtonContainer,
  HandlerParams,
} from "../ui/button";
import { createDialogContainer } from "../ui/dialog";

enum XUrlEnum {
  HOME = "/home",
  POST = "/compose/post",
  MESSAGES = "^/messages/[^/]+$", // 动态路径使用正则表达式
  OTHER = "/other",
}

function getXUrlEnum(url: string): XUrlEnum {
  const urlPath = new URL(url).pathname; // 提取 URL 路径
  // 获取所有枚举值
  const values = Object.values(XUrlEnum);
  // 检查 urlPath 是否以某个枚举值结尾
  for (const value of values) {
    if (value.startsWith("^")) { // 如果枚举值是正则表达式
      const regex = new RegExp(value);
      if (regex.test(urlPath)) {
        return value as XUrlEnum;
      }
    } else if (urlPath.endsWith(value)) { // 静态路径匹配
      return value as XUrlEnum;
    }
  }
  return XUrlEnum.OTHER;
}

// 定义翻译缓存接口
interface TranslateCache {
  id: string;
  originalText: string;
  translatedText: string;
  element: HTMLElement;
}

// 存储翻译缓存
const translateCache: Map<string, TranslateCache> = new Map();

// 创建翻译提示框
function createTranslateTooltip(): HTMLElement {
  const tooltip = document.createElement("div");
  tooltip.className = "translate-tooltip fixed z-50";
  tooltip.style.cssText = `
    display: none;
    left: 0;
    top: 0;
  `;
  document.body.appendChild(tooltip);

  // 创建一个简单的DOM结构，使用固定的白底黑字样式，不受页面主题影响
  tooltip.innerHTML = `
    <div style="background-color: #ffffff; color: #000000; border-radius: 0.5rem; padding: 0.75rem; margin: 0.5rem 0; border: 1px solid #e5e7eb; box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);">
      <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;">
        <svg xmlns="http://www.w3.org/2000/svg" style="height: 1rem; width: 1rem; color: #4b5563;" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M7 2a1 1 0 011 1v1h3a1 1 0 110 2H9.578a18.87 18.87 0 01-1.724 4.78c.29.354.596.696.914 1.026a1 1 0 11-1.44 1.389 21.034 21.034 0 01-.554-.6 19.098 19.098 0 01-3.107 3.567 1 1 0 01-1.334-1.49 17.087 17.087 0 003.13-3.733 18.992 18.992 0 01-1.487-2.494 1 1 0 111.79-.89c.234.47.489.928.764 1.372.417-.934.752-1.913.997-2.927H3a1 1 0 110-2h3V3a1 1 0 011-1zm6 6a1 1 0 01.894.553l2.991 5.982a.869.869 0 01.02.037l.99 1.98a1 1 0 11-1.79.895L15.383 16h-4.764l-.724 1.447a1 1 0 11-1.788-.894l.99-1.98.019-.038 2.99-5.982A1 1 0 0113 8zm-1.382 6h2.764L13 11.236 11.618 14z" clip-rule="evenodd" />
        </svg>
      </div>
      <span style="display: block; white-space: pre-wrap; line-height: 1.625; font-size: 0.875rem; color: #1f2937;" class="translate-content"></span>
    </div>
  `;

  return tooltip;
}

// 显示翻译提示框
function showTranslateTooltip(
  tooltip: HTMLElement,
  text: string,
  x: number,
  y: number,
) {
  console.log("显示翻译提示框:", text);

  // 直接更新内容
  const contentElement = tooltip.querySelector(".translate-content");
  if (contentElement) {
    contentElement.textContent = text;
  }

  tooltip.style.display = "block";
  tooltip.style.left = `${x}px`;
  tooltip.style.top = `${y}px`;
}

// 隐藏翻译提示框
function hideTranslateTooltip(tooltip: HTMLElement) {
  tooltip.style.display = "none";
}

export async function ttTwitterInit(url: string): Promise<void> {
  switch (getXUrlEnum(url)) {
    case XUrlEnum.HOME:
      execObserver(document.body, async () => {
        return await ttTwitterHome();
      });
      break;
    case XUrlEnum.POST:
      execObserver(document.body, async () => {
        return await ttTwitterPost();
      });
      break;
    case XUrlEnum.MESSAGES:
      execObserver(document.body, async () => {
        return await ttTwitterDM();
      });
      break;
    default:
      break;
  }

  if (config.value.basic.autoTranslate) {
    execObserver(document.body, async () => {
      if (config.value.basic.autoTranslate) {
        await ttTwitterTranslate();
        return false;
      }
      return false;
    });
  }
}

async function ttTwitterHome(): Promise<boolean> {
  const mainWrapper = document.querySelector(
    "main[role=main] div[data-testid=primaryColumn]",
  );
  const tweetTextareaWrapper = mainWrapper?.querySelector(
    "div[data-testid=tweetTextarea_0]",
  ) as HTMLElement;
  const toolBarParentWrapper = mainWrapper?.querySelector(
    "div[data-testid=toolBar]",
  );

  if (!toolBarParentWrapper || !tweetTextareaWrapper) {
    return false;
  }

  if (toolBarParentWrapper.getAttribute("tt-button-is-done") === "true") {
    return true;
  }

  createButtonContainer(
    toolBarParentWrapper as HTMLElement,
    ButtonLocationEnum.Previous,
  );

  // 将配置的按钮添加到buttonList
  buttonList.value.push(
    ...Object.values(config.value.buttons)
      .filter((btn) => btn.enabled)
      .map((btn) => ({
        ...btn,
        params: { data: { mainWrapper } },
        handler: generateHandle,
      })),
  );

  return true;
}

async function ttTwitterPost(): Promise<boolean> {
  const mainWrapper = document.querySelector("div[role=dialog]");
  const tweetTextareaWrapper = mainWrapper?.querySelector(
    "div[data-testid=tweetTextarea_0]",
  ) as HTMLElement | null;
  const toolBarParentWrapper = mainWrapper?.querySelector(
    "div[data-testid=toolBar]",
  );

  if (!toolBarParentWrapper || !tweetTextareaWrapper) {
    return false;
  }

  if (toolBarParentWrapper.getAttribute("tt-button-is-done") === "true") {
    return true;
  }

  createButtonContainer(
    toolBarParentWrapper as HTMLElement,
    ButtonLocationEnum.Previous,
  );

  const replayTweetTextWrapper = mainWrapper?.querySelector(
    "div[data-testid=tweetText",
  ) as HTMLElement;

  if (replayTweetTextWrapper) {
    // 回复场景
    const replayContent = replayTweetTextWrapper.textContent || "";
    if (replayContent === "") {
      return false;
    }

    // 从配置中获取回复按钮
    buttonList.value.push(
      ...Object.values(config.value.buttons)
        .filter((btn) => btn.enabled)
        .map((btn) => ({
          ...btn,
          params: { data: { mainWrapper, replayContent } },
          handler: generateHandle,
        })),
    );
  } else {
    // 发推场景
    buttonList.value.push(
      ...Object.values(config.value.buttons)
        .filter((btn) => btn.enabled)
        .map((btn) => ({
          ...btn,
          params: { data: { mainWrapper } },
          handler: generateHandle,
        })),
    );
  }

  return true;
}

async function ttTwitterDM(): Promise<boolean> {
  const dmWrapper = document.querySelector(
    "main[role=main] aside[role=complementary] button[data-testid=dmComposerSendButton]",
  );

  if (!dmWrapper) {
    return false;
  }

  if (dmWrapper.getAttribute("tt-button-is-done") === "true") {
    return true;
  }

  createButtonContainer(
    dmWrapper as HTMLElement,
    ButtonLocationEnum.ParentPrevious,
  );

  // 从配置中获取DM按钮
  buttonList.value.push(
    ...Object.values(config.value.buttons)
      .filter((btn) => btn.enabled)
      .map((btn) => ({
        ...btn,
        params: { data: { dmWrapper } },
        handler: dmGenerateHandle,
      })),
  );

  return true;
}

async function generateHandle(
  button: ButtonConfig,
  params: HandlerParams,
): Promise<void> {
  const { mainWrapper, replayContent } = params.data;
  if (!mainWrapper) {
    return;
  }

  const tweetTextareaWrapper = mainWrapper.querySelector(
    "div[data-testid=tweetTextarea_0]",
  ) as HTMLElement;

  if (!tweetTextareaWrapper) {
    return;
  }

  let sourceContent = replayContent || tweetTextareaWrapper.textContent || "";
  if (sourceContent === "") {
    return;
  }

  const message: AIGenarateRuntimeMessage = {
    type: RuntimeMessageTypeEnum.AI_GENARATE,
    data: {
      content: sourceContent,
      button: button, // 传递完整的按钮配置
    },
  };

  const response = await sendRuntimeMessage(message);
  if (!response.is_ok) {
    log_error("AI generate failed", response.error);
    return;
  }

  const generateText = response.data;
  createDialogContainer(
    generateText,
    () => {
      setInputText(tweetTextareaWrapper, generateText);
    },
    () => {
      log("Operation cancelled.");
    },
  );
}

async function dmGenerateHandle(
  button: ButtonConfig,
  params: HandlerParams,
): Promise<void> {
  const { dmWrapper } = params.data;
  if (!dmWrapper) {
    return;
  }

  const dmTextareaWrapper = dmWrapper.parentElement.querySelector(
    "div[data-testid=dmComposerTextInput]",
  ) as HTMLElement;

  if (!dmTextareaWrapper) {
    return;
  }
  const sourceContent = dmTextareaWrapper.textContent || "";
  if (sourceContent === "") {
    return;
  }
  const message: AIGenarateRuntimeMessage = {
    type: RuntimeMessageTypeEnum.AI_GENARATE,
    data: {
      content: sourceContent,
      button: button, // 传递完整的按钮配置
    },
  };
  const response = await sendRuntimeMessage(message);
  if (!response.is_ok) {
    log_error("AI generate failed", response.error);
    return;
  }

  const generateText = response.data;
  createDialogContainer(
    generateText,
    () => {
      setInputText(dmTextareaWrapper, generateText);
    },
    () => {
      log("Operation cancelled.");
    },
  );
}

async function ttTwitterTranslate(): Promise<void> {
  const mainWrapper = document.querySelector(
    "main[role=main] div[data-testid=primaryColumn]",
  );
  const ariaLabelWrapper = mainWrapper?.querySelector(
    "section[role=region] div[aria-label]",
  ) as HTMLElement | null;
  if (!ariaLabelWrapper) {
    return;
  }

  let tweetWrapperList = [
    ...ariaLabelWrapper.querySelectorAll(
      `div[aria-label] article[role=article]:not([tabindex="-1"]) div[lang]:not([data-has-translator=true]):not([lang^=zh])`,
    ),
  ];

  if (!tweetWrapperList.length) return;

  // 创建翻译提示框
  const tooltip = createTranslateTooltip();

  tweetWrapperList.forEach((tweetWrapper) => {
    tweetWrapper.setAttribute("data-has-translator", "true");
    const tweetId = tweetWrapper.getAttribute("id") ||
      Math.random().toString(36).substr(2, 9);

    // 获取所有文本内容
    const textElements = [...tweetWrapper.children].filter(
      (child) => child.tagName === "SPAN",
    );
    const textContents: string[] = [];

    textElements.forEach((span) => {
      const textContent = span.textContent;
      if (textContent) {
        textContents.push(textContent);
      }
    });

    if (textContents.length > 0) {
      const originalText = textContents.join(" ");

      // 检查缓存
      if (!translateCache.has(tweetId)) {
        // 翻译并缓存
        translateContent(TranslateChannelEnum.GOOGLE, originalText).then(
          (translatedText) => {
            if (translatedText) {
              translateCache.set(tweetId, {
                id: tweetId,
                originalText,
                translatedText,
                element: tweetWrapper as HTMLElement,
              });
            }
          },
        );
      }

      // 添加鼠标悬停事件
      tweetWrapper.addEventListener(
        "mouseenter",
        ((e: Event) => {
          const mouseEvent = e as MouseEvent;
          const cache = translateCache.get(tweetId);
          if (cache) {
            showTranslateTooltip(
              tooltip,
              cache.translatedText,
              mouseEvent.clientX + 10,
              mouseEvent.clientY + 10,
            );
          }
        }) as EventListener,
      );

      tweetWrapper.addEventListener("mouseleave", () => {
        hideTranslateTooltip(tooltip);
      });

      // 添加点击事件，隐藏翻译提示框
      tweetWrapper.addEventListener(
        "click",
        () => {
          hideTranslateTooltip(tooltip);
        },
      );

      // 添加鼠标移动事件，使提示框跟随鼠标
      tweetWrapper.addEventListener(
        "mousemove",
        ((e: Event) => {
          const mouseEvent = e as MouseEvent;
          if (tooltip.style.display === "block") {
            const cache = translateCache.get(tweetId);
            if (cache) {
              showTranslateTooltip(
                tooltip,
                cache.translatedText,
                mouseEvent.clientX + 10,
                mouseEvent.clientY + 10,
              );
            }
          }
        }) as EventListener,
      );
    }
  });
}
