import type { RuntimeMessageResponse } from "./runtime-message";
import { RuntimeMessageTypeEnum, sendRuntimeMessage } from "./runtime-message";
import { LocalServiceError } from "./local-service-error";
import { validateLocalServiceResponse } from "./local-service-contract";

export async function requestLocalService<T>(
  path: string,
  options: { method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; body?: unknown } = {},
): Promise<T> {
  const response: RuntimeMessageResponse = await sendRuntimeMessage({
    type: RuntimeMessageTypeEnum.LOCAL_SERVICE_REQUEST,
    data: { path, ...options },
  });
  if (!response.is_ok) throw new LocalServiceError(String(response.error), response.code);
  validateLocalServiceResponse(path, response.data);
  return response.data as T;
}
