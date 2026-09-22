import { isDebugLogEnabled } from "./config";

export function log(message?: any, ...optionalParams: any[]) {
  if (isDebugLogEnabled) {
    console.log(message, ...optionalParams);
  }
}

export function log_info(message?: any, ...optionalParams: any[]) {
  if (isDebugLogEnabled) {
    console.info(message, ...optionalParams);
  }
}

export function log_warn(message?: any, ...optionalParams: any[]) {
  if (isDebugLogEnabled) {
    console.warn(message, ...optionalParams);
  }
}

export function log_error(message?: any, ...optionalParams: any[]) {
  console.error(message, ...optionalParams);
}

const logger = {
  log,
  log_info,
  log_warn,
  log_error
};

export default logger;
