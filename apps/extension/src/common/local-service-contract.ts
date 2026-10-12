import { LOCAL_SERVICE_API_VERSION, type ServerSettings } from "@fast-social/contracts";
import { INCOMPATIBLE_SERVICE_MESSAGE, LocalServiceError } from "./local-service-error.ts";

// Validate at both boundaries: an options tab can outlive its background worker.
export function validateLocalServiceResponse(path: string, data: unknown): void {
  if (path === "/health") {
    if (!data || typeof data !== "object"
      || (data as { apiVersion?: number }).apiVersion !== LOCAL_SERVICE_API_VERSION) {
      throw new LocalServiceError(INCOMPATIBLE_SERVICE_MESSAGE, "LOCAL_SERVICE_INCOMPATIBLE");
    }
  }
  if (path === "/api/settings") {
    const settings = data as Partial<ServerSettings> | null;
    if (!Array.isArray(settings?.accounts)) {
      throw new LocalServiceError(INCOMPATIBLE_SERVICE_MESSAGE, "LOCAL_SERVICE_INCOMPATIBLE");
    }
    if (!Array.isArray(settings.ai?.services) || !Array.isArray(settings.interactionPrompts)
      || !Array.isArray(settings.x?.cookies) || !settings.telegram) {
      throw new LocalServiceError("本地服务返回了不完整的配置，请重新连接", "LOCAL_SERVICE_INVALID_RESPONSE");
    }
  }
}
