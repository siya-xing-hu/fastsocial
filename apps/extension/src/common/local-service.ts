import type { RuntimeMessageResponse } from "./runtime-message";
import { RuntimeMessageTypeEnum, sendRuntimeMessage } from "./runtime-message";

export async function requestLocalService<T>(
  path: string,
  options: { method?: "GET" | "POST" | "PUT" | "DELETE"; body?: unknown } = {},
): Promise<T> {
  const response: RuntimeMessageResponse = await sendRuntimeMessage({
    type: RuntimeMessageTypeEnum.LOCAL_SERVICE_REQUEST,
    data: { path, ...options },
  });
  if (!response.is_ok) throw new Error(String(response.error));
  return response.data as T;
}
