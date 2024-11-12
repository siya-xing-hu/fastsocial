import { config } from "../config/storage-config";
import { stringifyQueryParameter } from "./common";

export async function translate(
  text: string,
  locale: string,
): Promise<any> {
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
