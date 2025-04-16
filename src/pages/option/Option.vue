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
              <option
                v-for="service in config.aiServices"
                :key="service.id"
                :value="service.id"
                :disabled="!service.enabled"
              >
                {{ service.name }}
              </option>
            </select>
          </div>

          <div class="config-item">
            <label class="block text-sm font-medium text-gray-700 mb-2"
              >默认翻译服务</label
            >
            <select v-model="config.basic.translateProvider" class="form-input">
              <option value="google">Google 翻译</option>
              <option value="deepl">DeepL</option>
              <option value="ai">AI</option>
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

        <!-- AI 服务列表 -->
        <div class="mb-6">
          <div class="flex justify-between items-center mb-4">
            <h3 class="text-lg font-medium">已配置的服务</h3>
            <button
              @click="showAddService = true"
              class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              添加服务
            </button>
          </div>

          <!-- 服务列表 -->
          <div class="space-y-4">
            <div
              v-for="service in config.aiServices"
              :key="service.id"
              class="bg-white p-6 rounded-lg shadow-sm border border-gray-200"
              :class="{ 'border-blue-500': service.id === config.basic.aiProvider }"
            >
              <div class="flex justify-between items-start mb-4">
                <div>
                  <h4 class="text-lg font-medium">{{ service.name }}</h4>
                </div>
                <div class="flex items-center gap-2">
                  <label class="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      v-model="service.enabled"
                      class="sr-only peer"
                    />
                    <div
                      class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"
                    ></div>
                  </label>
                  <button
                    @click="removeService(service)"
                    class="p-2 text-gray-500 hover:text-red-600 transition-colors"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                      <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                    </svg>
                  </button>
                </div>
              </div>

              <!-- 服务配置表单 -->
              <div class="space-y-4">
                <div class="config-item">
                  <label class="block text-sm font-medium text-gray-700 mb-2">服务地址</label>
                  <input
                    type="text"
                    v-model="service.endpoint"
                    class="form-input"
                    placeholder="请输入服务地址"
                    @input="updateService(service)"
                  />
                </div>

                <div class="config-item">
                  <label class="block text-sm font-medium text-gray-700 mb-2">API Key</label>
                  <input
                    type="password"
                    v-model="service.apiKey"
                    class="form-input"
                    placeholder="请输入 API Key"
                    @input="updateService(service)"
                  />
                </div>

                <div class="config-item">
                  <label class="block text-sm font-medium text-gray-700 mb-2">模型</label>
                  <div class="space-y-2">
                    <div class="flex gap-2">
                      <select
                        v-model="service.model"
                        class="form-input flex-1"
                        @change="updateService(service)"
                      >
                        <option v-for="model in service.customModels" :key="model" :value="model">
                          {{ model }}
                        </option>
                      </select>
                      <button
                        @click="showAddModel = true; currentService = service"
                        class="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-md text-gray-600 transition-colors"
                      >
                        添加模型
                      </button>
                    </div>
                    <!-- 模型列表 -->
                    <div class="flex flex-wrap gap-2 mt-2">
                      <div
                        v-for="model in service.customModels"
                        :key="model"
                        class="flex items-center gap-1 px-2 py-1 bg-gray-100 rounded-md text-sm"
                      >
                        <span>{{ model }}</span>
                        <button
                          @click="removeModel(service, model)"
                          class="text-gray-500 hover:text-red-600 transition-colors"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- 添加服务对话框 -->
      <div
        v-if="showAddService"
        class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center"
      >
        <div class="bg-white rounded-lg p-6 w-[400px]">
          <h3 class="text-lg font-medium mb-4">添加 AI 服务</h3>
          <div class="space-y-4">
            <div class="config-item">
              <label class="block text-sm font-medium text-gray-700 mb-2">服务名称</label>
              <input
                type="text"
                v-model="newService.name"
                class="form-input"
                placeholder="请输入服务名称"
              />
            </div>
            <div class="config-item">
              <label class="block text-sm font-medium text-gray-700 mb-2">服务地址</label>
              <input
                type="text"
                v-model="newService.endpoint"
                class="form-input"
                placeholder="请输入服务地址"
              />
            </div>
            <div class="config-item">
              <label class="block text-sm font-medium text-gray-700 mb-2">API Key</label>
              <input
                type="password"
                v-model="newService.apiKey"
                class="form-input"
                placeholder="请输入 API Key"
              />
            </div>
            <div class="config-item">
              <label class="block text-sm font-medium text-gray-700 mb-2">默认模型</label>
              <input
                type="text"
                v-model="newService.model"
                class="form-input"
                placeholder="请输入默认模型名称"
              />
            </div>
          </div>
          <div class="flex justify-end gap-2 mt-6">
            <button
              @click="showAddService = false"
              class="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
            >
              取消
            </button>
            <button
              @click="addService"
              class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              确定
            </button>
          </div>
        </div>
      </div>

      <!-- 删除服务确认对话框 -->
      <div
        v-if="showDeleteServiceConfirm"
        class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center"
      >
        <div class="bg-white rounded-lg p-6 w-[400px]">
          <h3 class="text-lg font-medium mb-4">确认删除服务</h3>
          <p class="text-gray-600 mb-6">确定要删除服务 "{{ serviceToDelete?.name }}" 吗？此操作不可恢复。</p>
          <div class="flex justify-end gap-2">
            <button
              @click="showDeleteServiceConfirm = false"
              class="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
            >
              取消
            </button>
            <button
              @click="confirmDeleteService"
              class="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors"
            >
              删除
            </button>
          </div>
        </div>
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

      <!-- 翻译服务配置 -->
      <section v-if="currentMenu === 'translate'" class="max-w-2xl">
        <h2 class="text-xl font-medium mb-6">翻译服务配置</h2>
        
        <!-- 翻译 Prompt 配置 -->
        <div class="mb-6 bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <h3 class="text-lg font-medium mb-4">翻译提示词配置</h3>
          <div class="space-y-4">
            <div class="config-item">
              <label class="block text-sm font-medium text-gray-700 mb-2">翻译提示词</label>
              <textarea
                v-model="config.basic.translatePrompt"
                class="form-input min-h-[100px]"
                placeholder="请输入翻译提示词，可以使用 ${targetLang} 变量表示目标语言"
              ></textarea>
              <p class="mt-1 text-sm text-gray-500">
                提示：可以使用 ${targetLang} 变量来表示目标语言，例如：请将以下文本翻译成${targetLang}
              </p>
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
                v-model="config.translationService.deepl.apiKey"
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
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { config, initConfig, onInput } from "../../common/storage-config";
import { type AIServiceConfig } from "../../common/storage-config";
import type { ButtonConfig as ButtonConfigType } from "../../common/storage-config";
import ButtonConfig from "../../components/ui/ButtonConfig.vue";
import { log_error } from "../../common/logging";

// 使用 computed 优化菜单项
const menuItems = computed(() => [
  { key: "basic", label: "基础配置" },
  { key: "ai", label: "AI 服务" },
  { key: "translate", label: "翻译服务" },
  { key: "buttons", label: "按钮配置" },
]);

const currentMenu = ref("basic");
const showAddService = ref(false);
const showAddModel = ref(false);
const newModelName = ref("");
const currentService = ref<AIServiceConfig | null>(null);
const showDeleteServiceConfirm = ref(false);
const serviceToDelete = ref<AIServiceConfig | null>(null);

// 新服务配置
const newService = ref<Partial<AIServiceConfig>>({
  name: "",
  endpoint: "",
  apiKey: "",
  model: "",
  customModels: [],
  enabled: true
});

// 优化添加服务方法
const addService = () => {
  if (!newService.value.name || !newService.value.endpoint) {
    return;
  }

  const service: AIServiceConfig = {
    id: `custom-${Date.now()}`,
    name: newService.value.name,
    endpoint: newService.value.endpoint,
    apiKey: newService.value.apiKey || "",
    model: newService.value.model || "",
    customModels: [newService.value.model || ""],
    enabled: true
  };

  config.value.aiServices.push(service);
  showAddService.value = false;
  newService.value = {
    name: "",
    endpoint: "",
    apiKey: "",
    model: "",
    customModels: [],
    enabled: true
  };
};

// 优化移除服务方法
const removeService = (service: AIServiceConfig) => {
  serviceToDelete.value = service;
  showDeleteServiceConfirm.value = true;
};

// 确认删除服务
const confirmDeleteService = () => {
  if (!serviceToDelete.value) return;
  
  const index = config.value.aiServices.findIndex(s => s.id === serviceToDelete.value?.id);
  if (index > -1) {
    // 如果删除的是当前选中的服务，切换到第一个可用的服务
    if (serviceToDelete.value.id === config.value.basic.aiProvider) {
      const firstEnabled = config.value.aiServices.find(s => s.enabled && s.id !== serviceToDelete.value?.id);
      if (firstEnabled) {
        config.value.basic.aiProvider = firstEnabled.id;
      }
    }
    config.value.aiServices.splice(index, 1);
  }
  
  showDeleteServiceConfirm.value = false;
  serviceToDelete.value = null;
};

// 删除模型
const removeModel = (service: AIServiceConfig, model: string) => {
  if (!service.customModels) return;
  
  const index = service.customModels.indexOf(model);
  if (index > -1) {
    service.customModels.splice(index, 1);
    // 如果删除的是当前选中的模型，切换到第一个可用的模型
    if (model === service.model && service.customModels.length > 0) {
      service.model = service.customModels[0];
    }
  }
};

// 添加新的方法：更新服务配置
const updateService = (service: AIServiceConfig) => {
  const index = config.value.aiServices.findIndex(s => s.id === service.id);
  if (index !== -1) {
    config.value.aiServices[index] = { ...service };
  }
};

// 添加自定义模型
const addCustomModel = () => {
  if (!newModelName.value.trim() || !currentService.value) {
    return;
  }

  if (!currentService.value.customModels) {
    currentService.value.customModels = [];
  }

  if (currentService.value.customModels.includes(newModelName.value)) {
    return;
  }

  currentService.value.customModels.push(newModelName.value);
  newModelName.value = "";
  showAddModel.value = false;
  currentService.value = null;
};

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
    // 确保 aiServices 是数组
    if (!Array.isArray(config.value.aiServices)) {
      config.value.aiServices = [];
    }
  } catch (error) {
    log_error("初始化配置失败:", error);
    // 确保即使初始化失败也有默认值
    config.value.aiServices = [];
  }
});
</script>

<!-- 基础样式 - 可以添加到你的全局样式或组件样式中 -->
<style>
.form-input {
  @apply w-full rounded-md border-gray-300 bg-gray-50 shadow-sm text-base py-2.5 focus:border-blue-500 focus:ring-blue-500 focus:bg-white transition-colors;
}

.config-item {
  @apply space-y-2;
}

.service-item {
  @apply transition-all duration-200;
}

.service-item:hover {
  @apply shadow-md;
}
</style>
