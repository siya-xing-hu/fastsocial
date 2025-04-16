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
import { isContent, setInputText } from "../../utils/kit";
import { execObserver } from "../../utils/mutationObserver";
import {
  buttonList,
  ButtonLocationEnum,
  createButtonContainer,
  HandlerParams,
} from "../ui/button";
import { createDialogContainer } from "../ui/dialog";
import { translateContent } from "../translate/text-translator";

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
  tooltip.className =
    "translate-tooltip fixed z-50 rounded-lg shadow-lg p-3 max-w-sm";
  // 添加深色主题支持
  tooltip.style.cssText = `
    display: none;
    left: 0;
    top: 0;
    background-color: var(--background-color, #ffffff);
    color: var(--text-color, #000000);
    border: 1px solid var(--border-color, #e5e7eb);
  `;
  document.body.appendChild(tooltip);
  return tooltip;
}

// 显示翻译提示框
function showTranslateTooltip(
  tooltip: HTMLElement,
  text: string,
  x: number,
  y: number,
) {
  tooltip.textContent = text;
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
    ...Object.values(config.value.buttons.twitter.post)
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
      ...Object.values(config.value.buttons.twitter.reply)
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
      ...Object.values(config.value.buttons.twitter.post)
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
    ...Object.values(config.value.buttons.twitter.dm)
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
