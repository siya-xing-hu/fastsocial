/**
 * @fileoverview 用于 chrome.runtime.sendMessage 的统一消息结构
 */

import { ButtonTagEnum } from "../components/button";
import logger from "./logging";

// 用于 chrome.runtime.sendMessage 的统一消息结构
export enum RuntimeMessageTypeEnum {
  TRANSLATE = "translate",
  CONFIG_UPDATE = "config-update",
  AI_GENARATE = "ai-genarate",
}

export type RuntimeMessage =
  | TranslateRuntimeMessage
  | ConfigUpdateRuntimeMessage
  | AIGenarateRuntimeMessage;

export interface TranslateRuntimeMessage {
  type: RuntimeMessageTypeEnum.TRANSLATE;
  data: { content: string };
}

export interface ConfigUpdateRuntimeMessage {
  type: RuntimeMessageTypeEnum.CONFIG_UPDATE;
}

export interface AIGenarateRuntimeMessage {
  type: RuntimeMessageTypeEnum.AI_GENARATE;
  data: AIGenarateData;
}

export interface AIGenarateData {
  content: string;
  operation: ButtonTagEnum;
}

// 用于 chrome.runtime.sendMessage 的统一响应结构
export type RuntimeMessageResponse = OkRuntimeMessageResponse | ErrorRuntimeMessageResponse;

export interface OkRuntimeMessageResponse {
  is_ok: true;
  data?: any;
}

export interface ErrorRuntimeMessageResponse {
  is_ok: false;
  error: any;
}

// 封装 chrome.runtime.sendMessage 统一处理
export async function sendRuntimeMessage(message: RuntimeMessage) {
  const response: RuntimeMessageResponse = await chrome.runtime.sendMessage(message);
  logger.log("received response:", response);
  return response;
}
