import { AIServiceEnum, config, TranslateChannelEnum } from "../common/storage-config";
import { stringifyQueryParameter } from "./kit";
import { execGptPrompt } from "./ai";

async function googleTranslate(text: string, locale: string): Promise<string> {
  let url = import.meta.env.VITE_GOOGLE_TRANSLATOR_API + "?client=gtx&dt=t&" +
    stringifyQueryParameter({
      q: text,
      tl: config.value.basic.targetLang,
      sl: locale,
      client: "dict-chrome-ex",
    });

  const response = await fetch(url, {
    method: "GET",
  });

  const resp = await response.json();
  if (resp.error_code) {
    return Promise.reject(new Error("translate result error!"));
  }

  return resp[0]
    .map((item: any) => item[0])
    .filter((item: any) => typeof item === "string")
    .join("");
}

async function deeplTranslate(text: string, locale: string): Promise<string> {
  const apiKey = config.value.aiService.deepl.apiKey;
  if (!apiKey) {
    throw new Error("DeepL API key is not configured");
  }

  const url = "https://api-free.deepl.com/v2/translate";
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `DeepL-Auth-Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: [text],
      source_lang: locale.toUpperCase(),
      target_lang: config.value.basic.targetLang.toUpperCase(),
    }),
  });

  if (!response.ok) {
    throw new Error(`DeepL API error: ${response.statusText}`);
  }

  const data = await response.json();
  return data.translations[0].text;
}

async function aiTranslate(channel: TranslateChannelEnum, text: string): Promise<string> {
  const prompt = `请将以下文本翻译成${config.value.basic.targetLang}`;

  if (channel === TranslateChannelEnum.CHATGPT) {
    return await execGptPrompt(AIServiceEnum.OPENAI, prompt, text);
  } else if (channel === TranslateChannelEnum.OLLAMA) {
    return await execGptPrompt(AIServiceEnum.OLLAMA, prompt, text);
  }

  throw new Error(`Unsupported translation provider: ${channel}`);
}

export async function translate(channel: TranslateChannelEnum, text: string, locale: string): Promise<string> {
  switch (channel) {
    case TranslateChannelEnum.GOOGLE:
      return googleTranslate(text, locale);
    case TranslateChannelEnum.DEEPL:
      return deeplTranslate(text, locale);
    case TranslateChannelEnum.CHATGPT:
    case TranslateChannelEnum.OLLAMA:
      return aiTranslate(channel, text);
    default:
      throw new Error(`Unsupported translation provider: ${channel}`);
  }
}
