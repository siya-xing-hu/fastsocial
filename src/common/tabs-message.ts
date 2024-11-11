/**
 * @fileoverview 用于 chrome.runtime.sendMessage 的统一消息结构
 */

import logger from "./logging";

// 用于 chrome.tabs.sendMessage 的统一消息结构
export enum TabMessageTypeEnum {
  CONFIG_UPDATE = "config-update",
  X_URl = "x-url",
  PH_URl = "ph-url",
}

export type TabMessage =
  | ConfigUpdateTabMessage
  | PHUrlTabMessage
  | XUrlTabMessage;

export interface ConfigUpdateTabMessage {
  type: TabMessageTypeEnum.CONFIG_UPDATE;
}

export interface XUrlTabMessage {
  type: TabMessageTypeEnum.X_URl;
  data: { url: string };
}

export interface PHUrlTabMessage {
  type: TabMessageTypeEnum.PH_URl;
  data: { url: string };
}

// 用于 chrome.tabs.sendMessage 的统一响应结构
export type TabMessageResponse = OkTabMessageResponse | ErrorTabMessageResponse;

export interface OkTabMessageResponse {
  is_ok: true;
  data?: any;
}

export interface ErrorTabMessageResponse {
  is_ok: false;
  error: any;
}

// 封装 chrome.runtime.sendMessage 统一处理
export async function sendTabMessage(tabId: number, message: TabMessage) {
  const response: TabMessageResponse = await chrome.tabs.sendMessage(tabId, message);
  logger.log("received tabMessage response:", response);
  return response;
}
