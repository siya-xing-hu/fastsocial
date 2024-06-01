import logger from "../common/logging";

// 配置对象
const openConfig = {
  apiKey: "",
  org: "",
  model: "gpt-3.5-turbo",
};

export default openConfig;

// 初始化 OpenAI 函数
export async function initOpenAI() {
  try {
    // 从 chrome.storage.local 获取数据
    const { apiKey, org, model } = await chrome
      .storage.local.get([
        "apiKey",
        "org",
        "model",
      ]);

    // 更新配置对象
    if (apiKey) openConfig.apiKey = apiKey;
    if (org) openConfig.org = org;
    if (model) openConfig.model = model;

    logger.log("OpenAI configuration initialized:", openConfig);
  } catch (error) {
    logger.error("Error initializing OpenAI:", error);
  }
}
