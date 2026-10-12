export const INCOMPATIBLE_SERVICE_MESSAGE =
  "本地服务版本与插件不兼容，请在项目目录运行 docker compose up --build -d 更新服务，然后重新连接。";

export class LocalServiceError extends Error {
  readonly code: string;

  constructor(message: string, code = "LOCAL_SERVICE_ERROR") {
    super(message);
    this.name = "LocalServiceError";
    this.code = code;
  }
}
