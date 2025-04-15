import { config } from "../common/storage-config";
import { stringifyQueryParameter } from "./kit";

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

export async function translate(text: string, locale: string): Promise<string> {
  const provider = config.value.basic.provider;
  
  switch (provider) {
    case "google":
      return googleTranslate(text, locale);
    case "deepl":
      return deeplTranslate(text, locale);
    default:
      throw new Error(`Unsupported translation provider: ${provider}`);
  }
}
