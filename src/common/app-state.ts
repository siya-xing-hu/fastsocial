/**
 * @fileoverview Global app state for the extension.
 */

import { ref } from "vue";
import { APP_STATE_STORE_KEY } from "./consts";

export type AppState = {
  isLogin: boolean;
  user?: User | null;
};

export type User = {
  user_id: string;
  username: string;
};

// “全局”的 appState
export const appState = ref<AppState>({
  isLogin: false,
  user: null,
});

export async function storeAppState(newState: AppState) {
  await chrome.storage.local.set({
    [APP_STATE_STORE_KEY]: newState,
  });
}

export async function clearAppState() {
  await chrome.storage.local.remove([APP_STATE_STORE_KEY]);
}
