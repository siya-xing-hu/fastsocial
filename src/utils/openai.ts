import { log } from "../common/logging";
import { ButtonConfig } from "../config/storage-config";
import { config, OllamaConfig, OpenAIConfig } from "../config/storage-config";

export async function execGptPrompt(
  button: ButtonConfig,
  content: string,
): Promise<string> {

  let res;
  const aiProvider = config.value.basic.aiProvider;
  if (aiProvider === 'ollama') {
    res = await ollamaCreate(
      config.value.aiService.ollama,
      `${button.prompt}: "${content}", JSON 格式输出，输出格式： {"result": ""}`
    );
  } else if (aiProvider === 'chatgpt') {
    const messageData = [
      {
        "role": "system",
        "content": button.prompt
      },
      {
        "role": "user",
        "content": content
      }
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
