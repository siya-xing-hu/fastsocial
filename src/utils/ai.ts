import { log_info } from "../common/logging";
import { AIServiceConfig, config } from "../common/storage-config";

// 解析当前选择的服务ID和模型
const parseAIProvider = () => {
  const [serviceId = "", model = ""] = config.value.basic.aiProvider.split(":");
  return { serviceId, model };
};

// 获取当前启用的AI服务配置和模型
const getCurrentAIService = (): { service: AIServiceConfig, model: string } | null => {
  const { serviceId, model } = parseAIProvider();
  const currentService = config.value.aiServices.find(
    (service: AIServiceConfig) => service.id === serviceId
  );
  
  if (!currentService || !model) {
    return null;
  }
  
  return { service: currentService, model };
};

// 执行GPT提示
export const execGptPrompt = async (
  prompt: string,
  text: string,
): Promise<string> => {
  const serviceInfo = getCurrentAIService();
  if (!serviceInfo) {
    throw new Error("No AI service configured");
  }

  return aiCreate(prompt, text, serviceInfo.service, serviceInfo.model);
};

const aiCreate = async (
  prompt: string,
  text: string,
  service: AIServiceConfig,
  model: string,
): Promise<string> => {
  if (!service.apiKey) {
    throw new Error("API key is required");
  }

  const headers: HeadersInit = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${service.apiKey}`,
  };

  log_info(`aiCreate, ${service.endpoint}, ${model}, ${prompt}, ${text}`);

  const response = await fetch(service.endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: model,
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
