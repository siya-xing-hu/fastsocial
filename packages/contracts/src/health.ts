export const LOCAL_SERVICE_API_VERSION = 2;

export interface HealthResponse {
  ok: true;
  apiVersion: number;
  version: string;
  uptimeSeconds: number;
  database: "ok";
}
