import { log } from "../common/logging";
import { ButtonTagEnum } from "../components/button";
import { config, OllamaConfig, OpenAIConfig } from "../config/storage-config";

export async function execGptPrompt(
  operation: ButtonTagEnum,
  content: string,
): Promise<string> {

  let res;
  const aiProvider = config.value.basic.aiProvider;
  if (aiProvider === 'ollama') {
    res = await ollamaCreate(
      config.value.aiService.ollama,
      '帮我将引号里的内容翻译成英文："' + content + '", JSON 格式输出，输出格式： {"result": ""}'
    );
  } else if (aiProvider === 'chatgpt') {
    const messageData = [
    {
      "role": "system",
      "content":
        '你是一个 twitter 内容回复者，我需要你按照用户的回复要求，结合待回复的原文，生成一条回复内容，用英文输出，JSON 格式输出，输出格式： {"result": ""}',
    },
    {
      "role": "user",
      "content": `Replies to tweet: '${content}', Reply style: '${operation.toLocaleLowerCase()}'`,
    },
  ];
    res = await openaiCreate(config.value.aiService.openai, messageData);
  }

  const result_json = JSON.parse(res);
  return Promise.resolve(result_json.result);
}

export async function openaiCreate(
  config: OpenAIConfig,
  messageData: any,
  jsonFormat: boolean = true,
): Promise<any> {
  const reqBody = {
    model: config.model,
    messages: messageData,
    response_format: jsonFormat ? { type: "json_object" } : {},
  };

  const headers: HeadersInit = {
    "Authorization": `Bearer ${config.apiKey}`,
    "Content-Type": "application/json",
  };

  if (config.org) {
    headers["Openai-Organization"] = config.org;
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: headers,
    body: JSON.stringify(reqBody),
  });

  const jsonData = await response.json();

  log(`openai result: ${JSON.stringify(jsonData)}`);
  return jsonData.choices[0].message.content;
}

export async function ollamaCreate(
  config: OllamaConfig,
  messageData: string,
  jsonFormat: boolean = true,
): Promise<any> {
  const reqBody = {
    model: config.model,
    prompt: messageData,
    format: jsonFormat ? "json": "",
    stream: false
  };

  log(`openai request: ${JSON.stringify(reqBody)}`);

  const response = await fetch(config.endpoint + "/api/generate", {
    method: "POST",
    body: JSON.stringify(reqBody),
  });

  const jsonData = await response.json();
  
  log(`openai response: ${JSON.stringify(jsonData)}`);
  return jsonData.response;
}
