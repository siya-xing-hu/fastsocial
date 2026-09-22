export interface HealthResponse {
  ok: true;
  version: string;
  uptimeSeconds: number;
  database: "ok";
}
