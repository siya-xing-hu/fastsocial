import {
  config,
  DEFAULT_TRANSLATE_PROMPT,
  TranslateChannelEnum,
  getDeeplApiKey,
} from "../common/storage-config";
import { log_error, log_info } from "../common/logging";
import { NonRetryableError, stringifyQueryParameter } from "./kit";
import { execGptPrompt } from "./ai";

const AUTO_TRANSLATE_STATE_KEY = "fast-social-auto-translate-state";
const DEFAULT_DEEPL_ENDPOINT = "https://api.deepl.com/v2/translate";

interface AutoTranslateState {
  deeplUntil: number;
}

class GoogleTranslateUnavailableError extends NonRetryableError {}

let cachedDeeplUntil = 0;

function parseGoogleTranslateResponse(response: Response, body: string): any {
  const isBlocked = response.status === 429 ||
    response.url.includes("google.com/sorry") ||
    /captcha|unusual traffic/i.test(body);

  if (isBlocked) {
    throw new GoogleTranslateUnavailableError(
      "Google Translate temporarily blocked this request (rate limit/CAPTCHA). Please try again later or switch the translation provider to DeepL or AI.",
    );
  }

  if (!response.ok) {
    throw new Error(
      `Google Translate request failed: HTTP ${response.status} ${response.statusText}`,
    );
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() || "";
  if (!contentType.includes("json")) {
    throw new GoogleTranslateUnavailableError(
      `Google Translate returned an unexpected response (${contentType || "unknown content type"}) instead of JSON.`,
    );
  }

  try {
    return JSON.parse(body);
  } catch {
    throw new GoogleTranslateUnavailableError(
      "Google Translate returned malformed JSON.",
    );
  }
}

async function googleTranslate(text: string, locale: string): Promise<string> {
  const url = import.meta.env.VITE_GOOGLE_TRANSLATOR_API + "?" +
    stringifyQueryParameter({
      client: "gtx",
      dt: "t",
      q: text,
      tl: config.value.basic.targetLang,
      sl: locale,
    });

  const response = await fetch(url, {
    method: "GET",
  });

  const body = await response.text();
  const resp = parseGoogleTranslateResponse(response, body);
  if (resp.error_code) {
    return Promise.reject(new Error("translate result error!"));
  }

  return resp[0]
    .map((item: any) => item[0])
    .filter((item: any) => typeof item === "string")
    .join("");
}

async function deeplTranslate(text: string, locale: string): Promise<string> {
  const apiKey = getDeeplApiKey();
  if (!apiKey) {
    throw new NonRetryableError("DeepL API key is not configured");
  }

  const url = config.value.translationService.deeplApiEndpoint ||
    DEFAULT_DEEPL_ENDPOINT;
  const requestBody: {
    text: string[];
    target_lang: string;
    source_lang?: string;
  } = {
    text: [text],
    target_lang: normalizeDeeplTargetLanguage(config.value.basic.targetLang),
  };

  if (locale.toLowerCase() !== "auto") {
    requestBody.source_lang = locale.toUpperCase();
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `DeepL-Auth-Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  const body = await response.text();
  if (!response.ok) {
    const error = new Error(
      `DeepL API error: HTTP ${response.status} ${getDeeplErrorDetail(body, response.statusText)}`,
    );
    if (response.status >= 400 && response.status < 500) {
      throw new NonRetryableError(error.message);
    }
    throw error;
  }

  try {
    const data = JSON.parse(body);
    const translatedText = data.translations?.[0]?.text;
    if (typeof translatedText !== "string") {
      throw new Error("Translation text is missing");
    }
    return translatedText;
  } catch (error) {
    throw new NonRetryableError(
      `DeepL returned an invalid response: ${(error as Error).message}`,
    );
  }
}

function normalizeDeeplTargetLanguage(language: string): string {
  switch (language.toLowerCase()) {
    case "zh-cn":
    case "zh-tw":
      return "ZH";
    default:
      return language.toUpperCase();
  }
}

function getDeeplErrorDetail(body: string, fallback: string): string {
  try {
    const data = JSON.parse(body);
    if (typeof data.message === "string") {
      return data.message;
    }
  } catch {
    // DeepL may return an empty or non-JSON error response.
  }
  return fallback || "Unknown error";
}

function getFallbackDurationMs(): number {
  const configuredMinutes = Number(
    config.value.translationService.fallbackDurationMinutes,
  );
  const minutes = Number.isFinite(configuredMinutes)
    ? Math.max(1, configuredMinutes)
    : 5;
  return minutes * 60 * 1000;
}

async function getDeeplFallbackUntil(): Promise<number> {
  if (cachedDeeplUntil > Date.now()) {
    return cachedDeeplUntil;
  }

  try {
    const stored = await chrome.storage.session.get(AUTO_TRANSLATE_STATE_KEY);
    const state = stored[AUTO_TRANSLATE_STATE_KEY] as
      | AutoTranslateState
      | undefined;
    cachedDeeplUntil = Number(state?.deeplUntil) || 0;
  } catch (error) {
    log_error("Failed to read automatic translation state", error);
  }

  return cachedDeeplUntil;
}

async function enableDeeplFallback(): Promise<void> {
  cachedDeeplUntil = Date.now() + getFallbackDurationMs();
  const state: AutoTranslateState = { deeplUntil: cachedDeeplUntil };

  try {
    await chrome.storage.session.set({
      [AUTO_TRANSLATE_STATE_KEY]: state,
    });
  } catch (error) {
    log_error("Failed to persist automatic translation state", error);
  }

  log_info(
    `Google Translate is unavailable; using DeepL until ${new Date(cachedDeeplUntil).toISOString()}`,
  );
}

async function clearDeeplFallback(): Promise<void> {
  cachedDeeplUntil = 0;
  try {
    await chrome.storage.session.remove(AUTO_TRANSLATE_STATE_KEY);
  } catch (error) {
    log_error("Failed to clear automatic translation state", error);
  }
}

async function automaticTranslate(
  text: string,
  locale: string,
): Promise<string> {
  const fallbackUntil = await getDeeplFallbackUntil();
  if (fallbackUntil > Date.now()) {
    return deeplTranslate(text, locale);
  }

  if (fallbackUntil > 0) {
    await clearDeeplFallback();
  }

  try {
    return await googleTranslate(text, locale);
  } catch (error) {
    if (!getDeeplApiKey()) {
      if (error instanceof GoogleTranslateUnavailableError) {
        throw new NonRetryableError(
          "Google Translate is unavailable and automatic fallback requires a DeepL API key. Configure the key in Translation Settings.",
        );
      }
      throw error;
    }

    const translated = await deeplTranslate(text, locale);
    if (error instanceof GoogleTranslateUnavailableError) {
      await enableDeeplFallback();
    }
    return translated;
  }
}

export function buildTranslationPrompt(
  template: string,
  text: string,
  targetLang: string,
  isAdvanced: boolean,
): string {
  const instructions = isAdvanced
    ? "讲解不常用词汇和特殊用法，以供用户理解。"
    : "请直接输出翻译结果，不要过度解读。";

  return `${template.trim()}\n\n${instructions}`
    .replace(/\{targetLang\}/g, () => targetLang)
    .replace(/\{userContent\}/g, () => text);
}

export async function translate(channel: TranslateChannelEnum, text: string, is_advanced: boolean, locale: string): Promise<string> {
  switch (channel) {
    case TranslateChannelEnum.AUTO:
      return automaticTranslate(text, locale);
    case TranslateChannelEnum.GOOGLE:
      return googleTranslate(text, locale);
    case TranslateChannelEnum.DEEPL:
      return deeplTranslate(text, locale);
    case TranslateChannelEnum.AI:
      const prompt = buildTranslationPrompt(
        config.value.translationService.translatePrompt || DEFAULT_TRANSLATE_PROMPT,
        text,
        config.value.basic.targetLang,
        is_advanced,
      );
      try {
        return await execGptPrompt(undefined, [
          {
            role: "user",
            content: prompt,
          },
        ]);
      } catch (error) {
        log_error("AI translation unavailable; falling back to local translation providers", error);
        return automaticTranslate(text, locale);
      }
    default:
      throw new Error(`Unsupported translation provider: ${channel}`);
  }
}
