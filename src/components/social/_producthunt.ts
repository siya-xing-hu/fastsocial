import { log, log_error } from "../../common/logging";
import {
  AIGenarateRuntimeMessage,
  RuntimeMessageTypeEnum,
  sendRuntimeMessage,
} from "../../common/runtime-message";
import { ButtonConfig, config } from "../../common/storage-config";
import { setInputText } from "../../utils/kit";
import { execObserver } from "../../utils/mutationObserver";
import { buttonList, HandlerParams } from "../ui/button";
import { createDialogContainer } from "../ui/dialog";

export async function ttProductHuntInit(url: string): Promise<void> {
  execObserver(document.body, async () => {
    return await ttProductHuntReply();
  });
}

async function ttProductHuntReply(): Promise<boolean> {
  const formWrapper = document.querySelector(
    "main form[data-test=comment-form]",
  );
  const submitButtonWrapper = formWrapper?.querySelector(
    "button[data-test=form-submit-button]",
  ) as HTMLElement | null;
  if (!formWrapper || !submitButtonWrapper) {
    return false;
  }

  const targetWrapper = submitButtonWrapper.parentElement?.parentElement;
  if (!targetWrapper) {
    return false;
  }

  if (formWrapper.getAttribute("tt-button-is-done") === "true") {
    return false;
  }
  const textareaWrapper = targetWrapper.parentElement?.querySelector(
    "textarea",
  );

  buttonList.value.push(
    ...config.value.buttons
      .filter((btn) => btn.enabled)
      .map((btn) => ({
        ...btn,
        params: { data: { textareaWrapper } },
        handler: replyHandle,
      })),
  );

  return true;
}

async function replyHandle(
  button: ButtonConfig,
  params: HandlerParams,
): Promise<void> {
  const { textareaWrapper } = params.data;

  if (!textareaWrapper || textareaWrapper.textContent == "") {
    return;
  }

  const message: AIGenarateRuntimeMessage = {
    type: RuntimeMessageTypeEnum.AI_GENARATE,
    data: {
      content: textareaWrapper.textContent,
      button: button,
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
      // 确认按钮的回调
      setInputText(textareaWrapper, generateText);
    },
    () => {
      // 取消按钮的回调
      log("Operation cancelled.");
    },
  );

}
