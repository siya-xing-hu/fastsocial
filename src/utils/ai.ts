import { log_info } from "../common/logging";
import { AIServiceConfig, config } from "../common/storage-config";

// 获取当前启用的AI服务配置
const getCurrentAIService = (): AIServiceConfig | null => {
  const currentService = config.value.aiServices.find((service: AIServiceConfig) =>
    service.id === config.value.basic.aiProvider
  );
  return currentService || null;
};

// 执行GPT提示
export const execGptPrompt = async (
  prompt: string,
  text: string,
): Promise<string> => {
  const service = getCurrentAIService();
  if (!service) {
    throw new Error("No AI service configured");
  }

  return aiCreate(prompt, text, service);
};

const aiCreate = async (
  prompt: string,
  text: string,
  service: AIServiceConfig,
): Promise<string> => {
  if (!service.apiKey) {
    throw new Error("API key is required");
  }

  const headers: HeadersInit = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${service.apiKey}`,
  };

  log_info(`aiCreate, ${service.endpoint}, ${service.model}, ${prompt}, ${text}`);

  const response = await fetch(service.endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: service.model,
      messages: [
        {
          role: "system",
          content: prompt,
        },
        {
          role: "user",
          content: text,
        },
      ],
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.statusText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
};
