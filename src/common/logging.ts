import { isDebugLogEnabled } from "./config";

export function log(message?: any, ...optionalParams: any[]) {
  if (isDebugLogEnabled) {
    console.log(message, ...optionalParams);
  }
}

export function info(message?: any, ...optionalParams: any[]) {
  if (isDebugLogEnabled) {
    console.info(message, ...optionalParams);
  }
}

export function warn(message?: any, ...optionalParams: any[]) {
  if (isDebugLogEnabled) {
    console.warn(message, ...optionalParams);
  }
}

export function error(message?: any, ...optionalParams: any[]) {
  console.error(message, ...optionalParams);
}

const logger = {
  log,
  info,
  warn,
  error
};

export default logger;
