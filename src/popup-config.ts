import {
  ConfigUpdateMessage,
  MessageTypeEnum,
  sendMessage,
} from "./common/runtime-message";
import { debounce } from "./utils/common";

export const onInput = debounce(async (fieldName: string, value: string) => {
  await chrome.storage.local.set({ [fieldName]: value });

  if (chrome.runtime?.id) {
    const message: ConfigUpdateMessage = {
      type: MessageTypeEnum.CONFIG_UPDATE,
    };
    await sendMessage(message);
  }
}, 400);
