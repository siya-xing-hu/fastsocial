import { log } from "../common/logging";
import { AIServiceEnum, config } from "../common/storage-config";

export async function execGptPrompt(
  channel: AIServiceEnum,
  prompt: string,
  content: string,
): Promise<string> {

  let res;
  if (channel === AIServiceEnum.OLLAMA) {
    res = await ollamaCreate(
      `${prompt}: "${content}", JSON 格式输出，输出格式： {"result": ""}`
    );
  } else if (channel === AIServiceEnum.OPENAI) {
    const messageData = [
      {
        "role": "system",
        "content": prompt
      },
      {
        "role": "user",
        "content": content
      }
    ];
    res = await openaiCreate(messageData);
  }

  const result_json = JSON.parse(res);

  return Promise.resolve(result_json.result);
}

export async function openaiCreate(
  messageData: any,
  jsonFormat: boolean = true,
): Promise<any> {
  const openai = config.value.aiService.openai;

  if (!openai.apiKey) {
    throw new Error("OpenAI API key is not configured");
  }

  const reqBody = {
    model: openai.model,
    messages: messageData,
    response_format: jsonFormat ? { type: "json_object" } : {},
  };

  const headers: HeadersInit = {
    "Authorization": `Bearer ${openai.apiKey}`,
    "Content-Type": "application/json",
  };

  if (openai.org) {
    headers["Openai-Organization"] = openai.org;
  }

  log(`openai request: ${JSON.stringify(reqBody)}`);

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: headers,
    body: JSON.stringify(reqBody),
  });

  const jsonData = await response.json();
  log(`openai response: ${JSON.stringify(jsonData)}`);

  return jsonData.choices[0].message.content;
}

export async function ollamaCreate(
  messageData: string,
  jsonFormat: boolean = true,
): Promise<any> {
  const ollama = config.value.aiService.ollama;

  if (!ollama.endpoint) {
    throw new Error("Ollama endpoint is not configured");
  }

  const reqBody = {
    model: ollama.model,
    prompt: messageData,
    format: jsonFormat ? "json": "",
    stream: false
  };

  log(`ollama request: ${JSON.stringify(reqBody)}`);

  const response = await fetch(ollama.endpoint + "/api/generate", {
    method: "POST",
    body: JSON.stringify(reqBody),
  });


  const jsonData = await response.json();
  log(`ollama response: ${JSON.stringify(jsonData)}`);

  return jsonData.response;
}
