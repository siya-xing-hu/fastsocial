import {
  ConfigUpdateRuntimeMessage,
  RuntimeMessageTypeEnum,
  sendRuntimeMessage,
} from "./common/runtime-message";
import { debounce } from "./utils/common";

export const onInput = debounce(async (fieldName: string, value: string) => {
  await chrome.storage.local.set({ [fieldName]: value });

  const message: ConfigUpdateRuntimeMessage = {
    type: RuntimeMessageTypeEnum.CONFIG_UPDATE,
  };
  await sendRuntimeMessage(message);
}, 400);
