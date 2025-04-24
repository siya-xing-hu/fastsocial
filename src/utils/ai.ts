import { log_info } from "../common/logging";
import { AIServiceConfig, config, getServiceApiKey } from "../common/storage-config";

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
export const execGptPrompt = async (userContent: string): Promise<string> => {
  const serviceInfo = getCurrentAIService();
  if (!serviceInfo) {
    throw new Error("No AI service configured");
  }

  const { service, model } = serviceInfo;
  const apiKey = getServiceApiKey(service.id);

  if (!apiKey) {
    throw new Error("API key is required");
  }

  const headers: HeadersInit = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${apiKey}`,
  };

  log_info(`aiCreate, ${service.endpoint}, ${model}, ${userContent}`);

  const response = await fetch(service.endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: model,
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant.",
        },
        {
          role: "user",
          content: userContent,
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
