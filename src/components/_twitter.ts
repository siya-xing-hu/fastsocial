import { isContent, setInputText } from "../utils/common";
import {
  buttonList,
  ButtonLocationEnum,
  createButtonContainer,
  HandlerParams,
} from "./button";
import { createDialogContainer } from "./dialog";
import { execObserver } from "./util/mutationObserver";
import { translateContent } from "./translate";
import {
  AIGenarateRuntimeMessage,
  RuntimeMessageTypeEnum,
  sendRuntimeMessage,
} from "../common/runtime-message";
import logger, { log } from "../common/logging";
import { ButtonConfig, config } from "../config/storage-config";

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
      log("22 - ", config.value.basic.autoTranslate)
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

  log("111 = ", config.value.buttons.twitter.post)
  // 将配置的按钮添加到buttonList
  buttonList.value.push(
    ...Object.values(config.value.buttons.twitter.post)
      .filter(btn => btn.enabled)
      .map(btn => ({
        ...btn,
        params: { data: { mainWrapper } },
        handler: generateHandle,
      }))
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
        .filter(btn => btn.enabled)
        .map(btn => ({
          ...btn,
          params: { data: { mainWrapper, replayContent } },
          handler: generateHandle,
        }))
    );
  } else {
    // 发推场景
    buttonList.value.push(
      ...Object.values(config.value.buttons.twitter.post)
        .filter(btn => btn.enabled)
        .map(btn => ({
          ...btn,
          params: { data: { mainWrapper } },
          handler: generateHandle,
        }))
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
      .filter(btn => btn.enabled)
      .map(btn => ({
        ...btn,
        params: { data: { dmWrapper } },
        handler: dmGenerateHandle,
      }))
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
    logger.error("AI generate failed", response.error);
    return;
  }

  const generateText = response.data;
  createDialogContainer(
    generateText,
    () => {
      setInputText(tweetTextareaWrapper, generateText);
    },
    () => {
      console.log("Operation cancelled.");
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
    logger.error("AI generate failed", response.error);
    return;
  }

  const generateText = response.data;
  createDialogContainer(
    generateText,
    () => {
      setInputText(dmTextareaWrapper, generateText);
    },
    () => {
      console.log("Operation cancelled.");
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

  tweetWrapperList.forEach((tweetWrapper) => {
    tweetWrapper.setAttribute("data-has-translator", "true");

    // 获取 tweetWrapper 子节点的所有 span 元素
    const spanContentWrapper = [...tweetWrapper.querySelectorAll("span")];

    // 将 span 元素遍历，过滤出非表情的文本元素，将文本内容依次替换成 “你好”
    spanContentWrapper.forEach((span) => {
      // 如果 span 元素还有子节点，过滤
      const textContent = span.textContent;
      if (
        !textContent || !isContent(textContent) ||
        textContent.startsWith("http") ||
        textContent.startsWith("https") || textContent.startsWith("@") ||
        textContent.startsWith("#")
      ) {
        return;
      }
      // 翻译
      translateContent(textContent).then((translatedText) => {
        span.textContent = translatedText || textContent;
      });
    });
  });
}
