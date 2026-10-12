import type { SocialPost } from "@fast-social/contracts";
import type { FetchLike } from "../adapters/x/x-client.ts";
import type { SettingsRepository } from "../repositories/settings-repository.ts";

export class TelegramNotifier {
  private readonly settings: SettingsRepository;
  private readonly fetchImpl: FetchLike;

  constructor(settings: SettingsRepository, fetchImpl: FetchLike = fetch) {
    this.settings = settings;
    this.fetchImpl = fetchImpl;
  }

  async send(message: string, post?: SocialPost): Promise<void> {
    const settings = this.settings.getTelegram();
    if (!settings.botToken || !settings.chatId) {
      throw new Error("请先配置 Telegram Bot Token 和 Chat ID");
    }
    const text = post
      ? `${message}\n\n@${post.author} · ${formatDate(post.createdAt)}\n${post.url}`
      : message;
    let response: Response;
    try {
      response = await this.fetchImpl(
        `https://api.telegram.org/bot${settings.botToken}/sendMessage`,
        {
          method: "POST",
          signal: AbortSignal.timeout(15_000),
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: settings.chatId, text, disable_web_page_preview: false }),
        },
      );
    } catch (error) {
      // Network error messages may contain the request URL, including the bot token.
      const reason = isTimeout(error) ? "连接超时" : "连接失败";
      throw new Error(`Telegram ${reason}：无法连接 api.telegram.org，请检查服务所在环境的网络或代理设置`);
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Telegram 发送失败（${response.status}）${detail ? `：${detail.slice(0, 300)}` : ""}`);
    }
  }
}

function isTimeout(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object" || depth > 5) return false;
  const details = error as { name?: unknown; code?: unknown; cause?: unknown; errors?: unknown };
  return details.name === "TimeoutError"
    || ["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"].includes(String(details.code))
    || isTimeout(details.cause, depth + 1)
    || (Array.isArray(details.errors) && details.errors.some((item) => isTimeout(item, depth + 1)));
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}
