/**
 * @fileoverview 用于 chrome.runtime.sendMessage 的统一消息结构
 */

import logger from "./logging";

// 用于 chrome.runtime.sendMessage 的统一消息结构
export enum MessageTypeEnum {
  TRANSLATE = "translate",
  CONFIG_UPDATE = "config-update",
  AI_GENARATE = "ai-genarate",
  X_URl = "x-url",
}

export type Message =
  | TranslateMessage
  | ConfigUpdateMessage
  | AIGenarateMessage
  | XUrlMessage;

export interface TranslateMessage {
  type: MessageTypeEnum.TRANSLATE;
  data: { content: string };
}

export interface ConfigUpdateMessage {
  type: MessageTypeEnum.CONFIG_UPDATE;
}

export interface AIGenarateMessage {
  type: MessageTypeEnum.AI_GENARATE;
  data: AIGenarateData;
}

export interface XUrlMessage {
  type: MessageTypeEnum.X_URl;
  data: { url: string };
}

export interface AIGenarateData {
  content: string;
  operation: string;
}

// 用于 chrome.runtime.sendMessage 的统一响应结构
export type MessageResponse = OkMessageResponse | ErrorMessageResponse;

export interface OkMessageResponse {
  is_ok: true;
  data?: any;
}

export interface ErrorMessageResponse {
  is_ok: false;
  error: any;
}

// 关键 token 数据结构
export interface SessionTokens {
  access_token: string;
  refresh_token: string;
  provider_token: string;
}

export interface CallbackUrl {
  callback_url: string;
}

export function isSessionTokens(data: any): data is SessionTokens {
  return (
    data &&
    typeof data.access_token === "string" &&
    typeof data.refresh_token === "string"
  );
}

export function isCallbackUrl(data: any): data is CallbackUrl {
  return data && typeof data.callback_url === "string";
}

// 封装 chrome.runtime.sendMessage 统一处理
export async function sendMessage(message: Message) {
  const response: MessageResponse = await chrome.runtime.sendMessage(message);
  logger.log("received response:", response);
  return response;
}
