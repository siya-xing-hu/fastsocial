import { log_info, log_error } from "../common/logging";
import { AIServiceConfig, config, getServiceApiKey } from "../common/storage-config";

// 解析当前选择的服务ID和模型
const parseAIProvider = (aiProvider: string) => {
  const [serviceId = "", model = ""] = aiProvider.split(":");
  return { serviceId, model };
};

// 获取当前启用的AI服务配置和模型
const getCurrentAIService = (aiProvider: string): { service: AIServiceConfig, model: string } | null => {
  const { serviceId, model } = parseAIProvider(aiProvider);
  const currentService = config.value.aiServices.find(
    (service: AIServiceConfig) => service.id === serviceId
  );
  
  if (!currentService || !model) {
    return null;
  }
  
  return { service: currentService, model };
};

// 执行GPT提示
export const execGptPrompt = async (aiProvider: string, userContent: string): Promise<string> => {
  const serviceInfo = getCurrentAIService(aiProvider);
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

// 流式执行GPT提示
export const execGptPromptStream = async (
  aiProvider: string, 
  userContent: string, 
  onChunk: (chunk: string) => void,
  onError: (error: Error) => void,
  onComplete: () => void
): Promise<void> => {
  const serviceInfo = getCurrentAIService(aiProvider);
  if (!serviceInfo) {
    onError(new Error("No AI service configured"));
    return;
  }

  const { service, model } = serviceInfo;
  const apiKey = getServiceApiKey(service.id);

  if (!apiKey) {
    onError(new Error("API key is required"));
    return;
  }

  const headers: HeadersInit = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${apiKey}`,
  };

  log_info(`aiCreateStream, ${service.endpoint}, ${model}, ${userContent.substring(0, 50)}...`);

  try {
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
        stream: true, // 启用流式输出
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`API error: ${response.status} - ${errorText}`);
    }

    if (!response.body) {
      throw new Error("Response body is null");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let fullContent = "";
    let hasContent = false;

    try {
      // 处理流式响应
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          // 处理可能的剩余数据
          if (buffer.trim() && buffer.trim() !== "data: [DONE]") {
            try {
              if (buffer.trim().startsWith("data: ")) {
                const json = JSON.parse(buffer.trim().slice(6));
                if (json.choices && json.choices[0]?.delta?.content) {
                  const chunk = json.choices[0].delta.content;
                  fullContent += chunk;
                  onChunk(chunk);
                  hasContent = true;
                }
              }
            } catch (e) {
              log_error("处理最终缓冲区时出错", e);
            }
          }
          break;
        }
        
        const text = decoder.decode(value, { stream: true });
        buffer += text;
        
        // 处理分块数据
        const lines = buffer.split('\n');
        buffer = lines.pop() || "";
        
        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine || trimmedLine === "data: [DONE]") {
            continue;
          }
          
          if (trimmedLine.startsWith("data: ")) {
            try {
              const json = JSON.parse(trimmedLine.slice(6));
              if (json.choices && json.choices[0]?.delta?.content) {
                const chunk = json.choices[0].delta.content;
                fullContent += chunk;
                onChunk(chunk);
                hasContent = true;
              }
            } catch (error) {
              log_error("Error parsing SSE data", error);
            }
          }
        }
      }
      
      // 如果没有收到任何内容，可能是因为流式结构问题
      if (!hasContent) {
        log_error("未收到任何流内容");
        throw new Error("未收到任何响应内容");
      }
      
      onComplete();
    } catch (readError) {
      log_error("读取流时发生错误", readError);
      reader.cancel().catch(() => {}); // 取消读取器
      throw readError;
    }
  } catch (error) {
    log_error("Stream error", error);
    onError(error as Error);
  }
};
