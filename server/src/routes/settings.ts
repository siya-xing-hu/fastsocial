import type { FastifyInstance } from "fastify";
import type { ApiSuccess, ServerSettings } from "@fast-social/contracts";
import { validateSettingsPatch } from "../http/validation.ts";
import type { SettingsRepository } from "../repositories/settings-repository.ts";

export function registerSettingsRoutes(
  app: FastifyInstance,
  repository: SettingsRepository,
): void {
  app.get("/api/settings", async (): Promise<ApiSuccess<ServerSettings>> => ({
    ok: true,
    data: repository.getPublic(),
  }));

  app.put("/api/settings", async (request): Promise<ApiSuccess<ServerSettings>> => ({
    ok: true,
    data: repository.update(validateSettingsPatch(request.body)),
  }));
}
