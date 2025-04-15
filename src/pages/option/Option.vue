<template>
  <div class="flex min-h-screen bg-gray-50">
    <!-- 左侧导航 - 添加固定宽度和阴影 -->
    <aside
      class="fixed w-[200px] h-full bg-white shadow-sm border-r border-gray-200"
    >
      <div class="py-6 px-3">
        <h1 class="text-xl font-medium px-3 mb-6">设置</h1>
        <div
          v-for="item in menuItems"
          :key="item.key"
          :class="[
            'px-3 py-2 mb-1 rounded-md cursor-pointer text-gray-600 hover:bg-gray-100',
            currentMenu === item.key ? 'bg-gray-100 text-gray-900' : '',
          ]"
          @click="currentMenu = item.key"
        >
          {{ item.label }}
        </div>
      </div>
    </aside>

    <!-- 右侧配置区域 -->
    <main class="flex-1 ml-[200px] p-8">
      <!-- 基础配置 -->
      <section v-if="currentMenu === 'basic'" class="max-w-2xl">
        <h2 class="text-xl font-medium mb-6">基础配置</h2>

        <div
          class="space-y-6 bg-white p-6 rounded-lg shadow-sm border border-gray-200"
        >
          <!-- 配置项样式优化 -->
          <div class="config-item">
            <label class="block text-sm font-medium text-gray-700 mb-2"
              >默认AI服务</label
            >
            <select v-model="config.basic.aiProvider" class="form-input">
              <option value="chatgpt">ChatGPT</option>
              <option value="ollama">Ollama</option>
            </select>
          </div>

          <div class="config-item">
            <label class="block text-sm font-medium text-gray-700 mb-2"
              >默认翻译服务</label
            >
            <select v-model="config.basic.translateProvider" class="form-input">
              <option value="google">Google 翻译</option>
              <option value="deepl">DeepL</option>
              <option value="chatgpt">ChatGPT</option>
              <option value="ollama">Ollama</option>
            </select>
          </div>

          <div class="config-item">
            <label class="block text-sm font-medium text-gray-700 mb-2"
              >目标语言</label
            >
            <select v-model="config.basic.targetLang" class="form-input">
              <option value="zh-CN">中文</option>
              <option value="en">英文</option>
            </select>
          </div>

          <!-- 开关样式优化 -->
          <div class="flex items-center justify-between py-2">
            <label class="text-sm font-medium text-gray-700">自动翻译</label>
            <label class="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                v-model="config.basic.autoTranslate"
                class="sr-only peer"
              />
              <div
                class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"
              ></div>
            </label>
          </div>
        </div>
      </section>

      <!-- AI 服务配置 -->
      <section v-if="currentMenu === 'ai'" class="max-w-2xl">
        <h2 class="text-xl font-medium mb-6">AI 服务配置</h2>

        <!-- OpenAI 配置 -->
        <div
          class="mb-6 bg-white p-6 rounded-lg shadow-sm border border-gray-200"
        >
          <h3 class="text-lg font-medium mb-4">OpenAI</h3>
          <div class="space-y-4">
            <div class="config-item">
              <label class="block text-sm font-medium text-gray-700 mb-2"
                >API Key</label
              >
              <input
                type="password"
                v-model="config.aiService.openai.apiKey"
                class="form-input"
              />
            </div>
            <div class="config-item">
              <label class="block text-sm font-medium text-gray-700 mb-2"
                >组织 ID</label
              >
              <input
                type="text"
                v-model="config.aiService.openai.org"
                class="form-input"
              />
            </div>
            <div class="config-item">
              <label class="block text-sm font-medium text-gray-700 mb-2"
                >模型</label
              >
              <select
                v-model="config.aiService.openai.model"
                class="form-input"
              >
                <option value="gpt-3.5-turbo">GPT-3.5</option>
                <option value="gpt-4">GPT-4</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Ollama 配置 -->
        <div
          class="mb-6 bg-white p-6 rounded-lg shadow-sm border border-gray-200"
        >
          <h3 class="text-lg font-medium mb-4">Ollama</h3>
          <div class="space-y-4">
            <div class="config-item">
              <label class="block text-sm font-medium text-gray-700 mb-2"
                >服务地址</label
              >
              <input
                type="text"
                v-model="config.aiService.ollama.endpoint"
                class="form-input"
              />
            </div>
            <div class="config-item">
              <label class="block text-sm font-medium text-gray-700 mb-2"
                >模型</label
              >
              <div class="flex gap-2">
                <select
                  v-model="config.aiService.ollama.model"
                  class="form-input flex-1"
                >
                  <!-- 默认模型列表 -->
                  <option value="llama3">Llama 3</option>
                  <!-- 用户自定义模型 -->
                  <option disabled>──────────</option>
                  <option
                    v-for="model in config.aiService.ollama.customModels"
                    :key="model"
                    :value="model"
                  >
                    {{ model }}
                  </option>
                </select>
                <button
                  @click="showAddModel = true"
                  class="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-md text-gray-600 transition-colors"
                >
                  添加模型
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- DeepL 配置 -->
        <div
          class="mb-6 bg-white p-6 rounded-lg shadow-sm border border-gray-200"
        >
          <h3 class="text-lg font-medium mb-4">DeepL</h3>
          <div class="space-y-4">
            <div class="config-item">
              <label class="block text-sm font-medium text-gray-700 mb-2"
                >API Key</label
              >
              <input
                type="password"
                v-model="config.aiService.deepl.apiKey"
                class="form-input"
              />
              <p class="mt-1 text-sm text-gray-500">
                在
                <a
                  href="https://www.deepl.com/pro-api"
                  target="_blank"
                  class="text-blue-600 hover:underline"
                  >DeepL API</a
                >
                获取你的 API Key
              </p>
            </div>
          </div>
        </div>
      </section>

      <!-- 按钮配置部分 -->
      <section v-if="currentMenu === 'buttons'" class="max-w-2xl">
        <h2 class="text-xl font-medium mb-6">按钮配置</h2>

        <!-- Twitter 配置 -->
        <div
          class="mb-6 bg-white p-6 rounded-lg shadow-sm border border-gray-200"
        >
          <h3 class="text-lg font-medium mb-4">Twitter 按钮</h3>

          <!-- Post 按钮配置 -->
          <ButtonConfig
            title="POST 按钮"
            :buttons="config.buttons.twitter.post"
            platform="twitter"
            page="post"
            @add="addButton"
            @remove="removeButton"
          />

          <!-- Reply 按钮配置 -->
          <ButtonConfig
            title="REPLY 按钮"
            :buttons="config.buttons.twitter.reply"
            platform="twitter"
            page="reply"
            @add="addButton"
            @remove="removeButton"
          />

          <!-- DM 按钮配置 -->
          <ButtonConfig
            title="DM 按钮"
            :buttons="config.buttons.twitter.dm"
            platform="twitter"
            page="dm"
            @add="addButton"
            @remove="removeButton"
          />
        </div>

        <!-- ProductHunt 配置 -->
        <div
          class="mb-6 bg-white p-6 rounded-lg shadow-sm border border-gray-200"
        >
          <h3 class="text-lg font-medium mb-4">ProductHunt 按钮</h3>

          <!-- Reply 按钮配置 -->
          <ButtonConfig
            title="REPLY 按钮"
            :buttons="config.buttons.producthunt.reply"
            platform="producthunt"
            page="reply"
            @add="addButton"
            @remove="removeButton"
          />
        </div>
      </section>

      <!-- 保存按钮 -->
      <div class="fixed bottom-8 right-8">
        <button
          @click="saveConfig"
          class="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-sm transition-colors"
        >
          保存配置
        </button>
      </div>
    </main>
  </div>

  <!-- 添加模型对话框 -->
  <div
    v-if="showAddModel"
    class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center"
  >
    <div class="bg-white rounded-lg p-6 w-[400px]">
      <h3 class="text-lg font-medium mb-4">添加自定义模型</h3>
      <input
        type="text"
        v-model="newModelName"
        placeholder="请输入模型名称"
        class="form-input mb-4"
      />
      <div class="flex justify-end gap-2">
        <button
          @click="showAddModel = false"
          class="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
        >
          取消
        </button>
        <button
          @click="addCustomModel"
          class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
        >
          确定
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { config, initConfig, onInput } from "../../common/storage-config";
import type { ButtonConfig as ButtonConfigType } from "../../common/storage-config";
import ButtonConfig from "../../components/ui/ButtonConfig.vue";
import { log_error } from "../../common/logging";

// 使用 computed 优化菜单项
const menuItems = computed(() => [
  { key: "basic", label: "基础配置" },
  { key: "ai", label: "AI 服务" },
  { key: "buttons", label: "按钮配置" },
]);

const currentMenu = ref("basic");
const showAddModel = ref(false);
const newModelName = ref("");

// 优化保存配置方法
const saveConfig = async () => {
  try {
    onInput();
    // 可以添加保存成功的提示
  } catch (error) {
    log_error("保存配置失败:", error);
    // 可以添加保存失败的提示
  }
};

// 优化添加自定义模型方法
const addCustomModel = () => {
  if (!newModelName.value.trim()) {
    return;
  }

  if (!config.value.aiService.ollama.customModels) {
    config.value.aiService.ollama.customModels = [];
  }

  // 检查是否已存在相同名称的模型
  if (config.value.aiService.ollama.customModels.includes(newModelName.value)) {
    // 可以添加提示：模型已存在
    return;
  }

  config.value.aiService.ollama.customModels.push(newModelName.value);
  newModelName.value = "";
  showAddModel.value = false;
};

// 优化按钮操作方法
const addButton = (platform: string, page: string) => {
  const newButton: ButtonConfigType = {
    id: Date.now().toString(),
    name: "新按钮",
    icon: "✨",
    prompt: "请输入提示词",
    enabled: true,
  };

  const buttons = getButtonsByPlatform(platform, page);
  if (!buttons) return;

  buttons.push(newButton);
  updateButtons(platform, page, buttons);
};

const removeButton = (platform: string, page: string, id: string) => {
  const buttons = getButtonsByPlatform(platform, page);
  if (!buttons) return;

  const index = buttons.findIndex((b) => b.id === id);
  if (index > -1) {
    buttons.splice(index, 1);
    updateButtons(platform, page, buttons);
  }
};

// 辅助函数：获取按钮列表
const getButtonsByPlatform = (
  platform: string,
  page: string
): ButtonConfigType[] | undefined => {
  if (platform === "twitter") {
    return config.value.buttons.twitter[
      page as keyof typeof config.value.buttons.twitter
    ] as ButtonConfigType[];
  } else if (platform === "producthunt") {
    return config.value.buttons.producthunt[
      page as keyof typeof config.value.buttons.producthunt
    ] as ButtonConfigType[];
  }
  return undefined;
};

// 辅助函数：更新按钮列表
const updateButtons = (
  platform: string,
  page: string,
  buttons: ButtonConfigType[]
) => {
  if (platform === "twitter") {
    config.value.buttons.twitter[
      page as keyof typeof config.value.buttons.twitter
    ] = buttons;
  } else if (platform === "producthunt") {
    config.value.buttons.producthunt[
      page as keyof typeof config.value.buttons.producthunt
    ] = buttons;
  }
};

onMounted(async () => {
  try {
    await initConfig();
  } catch (error) {
    log_error("初始化配置失败:", error);
  }
});
</script>

<!-- 基础样式 - 可以添加到你的全局样式或组件样式中 -->
<style>
.form-input {
  @apply w-full rounded-md border-gray-300 bg-gray-50 shadow-sm text-base py-2.5 focus:border-blue-500 focus:ring-blue-500 focus:bg-white transition-colors;
}
</style>
