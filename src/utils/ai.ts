import { log } from "../common/logging";
import { AIServiceEnum, config } from "../common/storage-config";

export async function execGptPrompt(
  channel: AIServiceEnum,
  prompt: string,
  content: string,
): Promise<string> {
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

  let res;
  if (channel === AIServiceEnum.OLLAMA) {
    res = await ollamaCreate(messageData);
  } else if (channel === AIServiceEnum.OPENAI) {
   
    res = await openaiCreate(messageData);
  }

  return Promise.resolve(res);
}

export async function openaiCreate(
  messageData: any
): Promise<any> {
  const openai = config.value.aiService.openai;

  if (!openai.apiKey) {
    throw new Error("OpenAI API key is not configured");
  }

  const reqBody = {
    model: openai.model,
    messages: messageData,
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
  messageData: any
): Promise<any> {
  const ollama = config.value.aiService.ollama;

  if (!ollama.endpoint) {
    throw new Error("Ollama endpoint is not configured");
  }

  const reqBody = {
    model: ollama.model,
    messages: messageData,
    stream: false
  };


  log(`ollama request: ${JSON.stringify(reqBody)}`);

  const response = await fetch(ollama.endpoint + "/v1/chat/completions", {
    method: "POST",
    body: JSON.stringify(reqBody),
  });


  const jsonData = await response.json();
  log(`ollama response: ${JSON.stringify(jsonData)}`);

  return jsonData.choices[0].message.content;
}
