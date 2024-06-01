/**
 * @fileoverview The Helpers.
 */

import logger from "./logging";

export const isBrowser = () => typeof document !== "undefined";

export function encodeURLSearchParams(params: URLSearchParams) {
  const encodedParams = [];
  for (const [key, value] of params) {
    encodedParams.push(
      `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
    );
  }
  return encodedParams.join("&");
}

export async function getValueFromLocalStorage<T = any>(
  key: string,
): Promise<T | null> {
  const items = await chrome.storage.local.get(key);
  return items[key] || null;
}

export async function setCurrentTabIdToLocalStorage(key: string) {
  logger.log("setCurrentTabIdToLocalStorage");
  const currentTabId = await getCurrentActiveTabId();
  if (currentTabId === undefined) {
    throw new Error("no active tab");
  }
  await chrome.storage.local.set({
    [key]: currentTabId,
  });
  return currentTabId;
}

export async function getCookieValue(name: string, url: string) {
  const cookie = await chrome.cookies.get({ name, url });
  return cookie?.value ? decodeURIComponent(cookie.value) : null;
}

// 获取当前 tab id。 background 可用
export async function getCurrentActiveTabId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs.length > 0) {
    const tab = tabs[0];
    if (tab.url?.startsWith("chrome://")) {
      return;
    }
    if (tab.id === undefined) {
      return;
    }
    return tab.id;
  }
}

export function largerAvatarUrl(url: string, suffix?: string) {
  return url.replace("_normal", suffix ?? "_400x400");
}
