/**
 * @fileoverview 全局配置文件/常量
 */

const PROD_MODE_NAME = "production";
const DEV_MODE_NAME = "development";

export const mode = import.meta.env.MODE;

export const isDev = DEV_MODE_NAME === mode;
export const isProd = PROD_MODE_NAME === mode;

export const isDebugEnabled = import.meta.env.VITE_DEBUG_ENABLED === "true";

export const isDebugLogEnabled = import.meta.env.VITE_DEBUG_LOG === "true";
