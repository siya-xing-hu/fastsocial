import { config, TranslateChannelEnum } from "../common/storage-config";
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
  const apiKey = config.value.translationService.deepl.apiKey;
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

export async function translate(channel: TranslateChannelEnum, text: string, is_advanced: boolean, locale: string): Promise<string> {
  switch (channel) {
    case TranslateChannelEnum.GOOGLE:
      return googleTranslate(text, locale);
    case TranslateChannelEnum.DEEPL:
      return deeplTranslate(text, locale);
    case TranslateChannelEnum.AI:
      let prompt = config.value.translationService.translatePrompt;
      if (!prompt) {
        prompt = "请将以下文本翻译成${targetLang}。翻译要求：1. 保持专业术语的准确性，对于专业术语可以选择不翻译；2. 保持原文的语气和风格；3. 确保翻译的流畅性和自然度。";
      }
      if (is_advanced) {
        prompt += "讲解不常用词汇和特殊用法，以供用户理解。";
      } else {
        prompt += "请直接输出翻译结果，不要过度解读。";
      }
      return await execGptPrompt(prompt.replace("${targetLang}", config.value.basic.targetLang), text);
    default:
      throw new Error(`Unsupported translation provider: ${channel}`);
  }
}
