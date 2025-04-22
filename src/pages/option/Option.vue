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
                v-for="option in serviceModelOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select>
          </div>

          <div class="config-item">
            <label class="block text-sm font-medium text-gray-700 mb-2"
              >翻译服务</label
            >
            <select v-model="config.basic.translateProvider" class="form-input">
              <option value="google">Google</option>
              <option value="ai">AI</option>
              <option value="deepl">DeepL</option>
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
          </div>

          <!-- 服务列表 -->
          <div class="space-y-4">
            <div
              v-for="service in config.aiServices"
              :key="service.id"
              :data-service-id="service.id"
              class="bg-white p-6 rounded-lg shadow-sm border border-gray-200"
              :class="{
                'border-blue-500': getSelectedProviderModel().serviceId === service.id,
              }"
            >
              <div class="flex justify-between items-start mb-4">
                <div>
                  <input
                    v-if="service.id === newServiceId"
                    type="text"
                    v-model="service.name"
                    class="form-input"
                    placeholder="请输入服务名称"
                    @input="updateService(service)"
                  />
                  <h4 v-else class="text-lg font-medium">{{ service.name }}</h4>
                </div>
                <div class="flex items-center gap-2">
                  <label
                    class="relative inline-flex items-center cursor-pointer"
                  >
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
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      class="h-5 w-5"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fill-rule="evenodd"
                        d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                        clip-rule="evenodd"
                      />
                    </svg>
                  </button>
                </div>
              </div>

              <!-- 服务配置表单 -->
              <div class="space-y-4">
                <div class="config-item">
                  <label class="block text-sm font-medium text-gray-700 mb-2"
                    >服务地址</label
                  >
                  <input
                    type="text"
                    v-model="service.endpoint"
                    class="form-input"
                    placeholder="请输入服务地址"
                    @input="updateService(service)"
                  />
                </div>

                <div class="config-item">
                  <label class="block text-sm font-medium text-gray-700 mb-2"
                    >API Key</label
                  >
                  <input
                    type="password"
                    v-model="service.apiKey"
                    class="form-input"
                    placeholder="请输入 API Key"
                    @input="updateService(service)"
                  />
                </div>

                <div class="config-item">
                  <label class="block text-sm font-medium text-gray-700 mb-2"
                    >模型列表</label
                  >
                  <div class="mb-3">
                    <div class="flex gap-2">
                      <input
                        type="text"
                        v-model="newModelName"
                        placeholder="输入模型名称并按回车添加"
                        @keydown.enter.prevent="addCustomModelDirectly(service)"
                        class="form-input flex-1"
                      />
                    </div>
                  </div>
                  
                  <!-- 模型列表 -->
                  <div class="flex flex-wrap gap-2 mt-2">
                    <div
                      v-for="model in service.customModels"
                      :key="model"
                      :class="[
                        'flex items-center gap-1 px-2 py-1 rounded-md text-sm',
                        getSelectedProviderModel().model === model && 
                        getSelectedProviderModel().serviceId === service.id ? 
                        'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-700'
                      ]"
                      @click="selectServiceModel(service.id, model)"
                    >
                      <span>{{ model }}</span>
                      <button
                        @click.stop="removeModel(service, model)"
                        class="text-gray-500 hover:text-red-600 transition-colors"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          class="h-4 w-4"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                        >
                          <path
                            fill-rule="evenodd"
                            d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                            clip-rule="evenodd"
                          />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            
            <!-- 添加服务按钮 -->
            <button
              @click="addEmptyService"
              :disabled="isAddingService"
              class="w-full py-4 flex items-center justify-center bg-gray-50 border border-dashed border-gray-300 rounded-lg hover:bg-gray-100 transition-colors text-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
            </button>
          </div>
        </div>
      </section>

      <!-- 翻译服务配置 -->
      <section v-if="currentMenu === 'translate'" class="max-w-2xl">
        <h2 class="text-xl font-medium mb-6">翻译服务配置</h2>

        <!-- 翻译 Prompt 配置 -->
        <div
          class="mb-6 bg-white p-6 rounded-lg shadow-sm border border-gray-200"
        >
          <h3 class="text-lg font-medium mb-4">翻译提示词配置</h3>
          <div class="space-y-4">
            <div class="config-item">
              <label class="block text-sm font-medium text-gray-700 mb-2"
                >翻译提示词</label
              >
              <textarea
                v-model="config.translationService.translatePrompt"
                class="form-input min-h-[100px]"
                placeholder="请输入翻译提示词，可以使用 ${targetLang} 变量表示目标语言"
              ></textarea>
              <p class="mt-1 text-sm text-gray-500">
                提示：可以使用 ${targetLang}
                变量来表示目标语言，例如：请将以下文本翻译成${targetLang}
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

        <!-- 按钮列表 -->
        <div class="mb-6">
          <div class="flex justify-between items-center mb-4">
            <h3 class="text-lg font-medium">已配置的按钮</h3>
          </div>

          <!-- 按钮列表 -->
          <div class="space-y-4">
            <div
              v-for="button in config.buttons"
              :key="button.id"
              :data-button-id="button.id"
              class="bg-white p-6 rounded-lg shadow-sm border border-gray-200"
            >
              <div class="flex justify-between items-start mb-4">
                <div class="flex items-center gap-2">
                  <span class="text-2xl">{{ button.icon }}</span>
                  <input
                    v-if="button.id === newButtonId"
                    type="text"
                    v-model="button.name"
                    class="form-input"
                    placeholder="请输入按钮名称"
                    @input="updateButton(button)"
                  />
                  <h4 v-else class="text-lg font-medium">{{ button.name }}</h4>
                </div>
                <div class="flex items-center gap-2">
                  <label
                    class="relative inline-flex items-center cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      v-model="button.enabled"
                      class="sr-only peer"
                    />
                    <div
                      class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"
                    ></div>
                  </label>
                  <button
                    @click="removeButton(button)"
                    class="p-2 text-gray-500 hover:text-red-600 transition-colors"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      class="h-5 w-5"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fill-rule="evenodd"
                        d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                        clip-rule="evenodd"
                      />
                    </svg>
                  </button>
                </div>
              </div>

              <!-- 按钮配置表单 -->
              <div class="space-y-4">
                <div class="config-item">
                  <div class="flex gap-4">
                    <div class="flex-1">
                      <label
                        class="block text-sm font-medium text-gray-700 mb-2"
                        >按钮名称</label
                      >
                      <input
                        type="text"
                        v-model="button.name"
                        class="form-input"
                        placeholder="请输入按钮名称"
                        @input="updateButton(button)"
                      />
                    </div>
                    <div class="flex-1">
                      <label
                        class="block text-sm font-medium text-gray-700 mb-2"
                        >按钮图标</label
                      >
                      <div class="relative">
                        <select
                          v-model="button.icon"
                          class="form-input"
                          @change="updateButton(button)"
                        >
                          <option
                            v-for="icon in buttonIconOptions"
                            :key="icon.value"
                            :value="icon.value"
                          >
                            {{ icon.label }}
                          </option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>

                <div class="config-item">
                  <label class="block text-sm font-medium text-gray-700 mb-2"
                    >提示词</label
                  >
                  <textarea
                    v-model="button.prompt"
                    class="form-input min-h-[100px]"
                    placeholder="请输入提示词"
                    @input="updateButton(button)"
                  ></textarea>
                </div>
              </div>
            </div>
            
            <!-- 添加按钮按钮 -->
            <button
              @click="addEmptyButton"
              :disabled="isAddingButton"
              class="w-full py-4 flex items-center justify-center bg-gray-50 border border-dashed border-gray-300 rounded-lg hover:bg-gray-100 transition-colors text-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
            </button>
          </div>
        </div>
      </section>

      <!-- 删除确认对话框 -->
      <div
        v-if="showDeleteConfirm"
        class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center"
      >
        <div class="bg-white rounded-lg p-6 w-[400px]">
          <h3 class="text-lg font-medium mb-4">
            确认删除{{ itemToDelete?.type === "service" ? "服务" : "按钮" }}
          </h3>
          <p class="text-gray-600 mb-6">
            确定要删除{{
              itemToDelete?.type === "service" ? "服务" : "按钮"
            }}
            "{{ itemToDelete?.item.name }}" 吗？此操作不可恢复。
          </p>
          <div class="flex justify-end gap-2">
            <button
              @click="showDeleteConfirm = false"
              class="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
            >
              取消
            </button>
            <button
              @click="confirmDelete"
              class="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors"
            >
              删除
            </button>
          </div>
        </div>
      </div>

      <!-- 保存按钮 -->
      <div class="fixed bottom-8 right-8">
        <button
          @click="saveConfig"
          class="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-sm transition-all transform active:scale-95"
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
import {
  type AIServiceConfig,
  ButtonIconEnum,
} from "../../common/storage-config";
import { type ButtonConfig } from "../../common/storage-config";
import { log_error } from "../../common/logging";

// 使用 computed 优化菜单项
const menuItems = computed(() => [
  { key: "basic", label: "基础配置" },
  { key: "ai", label: "AI 服务" },
  { key: "translate", label: "翻译服务" },
  { key: "buttons", label: "按钮配置" },
]);

const currentMenu = ref("basic");
const newServiceId = ref<string | null>(null);
const isAddingService = ref(false);
const newModelName = ref("");
const newButtonId = ref<string | null>(null);
const isAddingButton = ref(false);
const showDeleteConfirm = ref(false);
const itemToDelete = ref<{ type: "service" | "button"; item: any } | null>(null);

// 新服务配置
interface NewServiceConfig extends Omit<AIServiceConfig, 'id'> {
  model?: string; // 临时字段，用于初始化
}

// 获取所有按钮图标选项
const buttonIconOptions = computed(() => {
  // 过滤掉数字索引，只保留实际的图标值
  return Object.values(ButtonIconEnum)
    .filter((value) => typeof value === "string")
    .map((icon) => ({
      value: icon,
      label: icon,
    }));
});

// 处理选中的服务和模型
interface SelectedProviderModel {
  serviceId: string;
  model: string;
}

// 获取当前选择的服务和模型
const getSelectedProviderModel = () => {
  const [serviceId = "", model = ""] = config.value.basic.aiProvider.split(":");
  return { serviceId, model } as SelectedProviderModel;
};

// 选择服务和模型
const selectServiceModel = (serviceId: string, model: string) => {
  config.value.basic.aiProvider = `${serviceId}:${model}`;
  onInput();
};

// 直接添加自定义模型
const addCustomModelDirectly = (service: AIServiceConfig) => {
  if (!newModelName.value.trim()) return;
  
  if (!service.customModels) {
    service.customModels = [];
  }

  // 检查是否已存在
  if (service.customModels.includes(newModelName.value)) {
    return;
  }

  service.customModels.push(newModelName.value);
  newModelName.value = "";
  updateService(service);
};

// 直接在列表添加空服务
const addEmptyService = () => {
  if (isAddingService.value) return;
  
  isAddingService.value = true;
  const id = `custom-${Date.now()}`;
  newServiceId.value = id;
  
  const service: AIServiceConfig = {
    id: id,
    name: "",
    endpoint: "",
    apiKey: "",
    customModels: [],
    enabled: true,
  };
  
  config.value.aiServices.push(service);
  
  // 设置焦点到新添加的服务（可选）
  setTimeout(() => {
    const newServiceElement = document.querySelector(`[data-service-id="${id}"] input`);
    if (newServiceElement) {
      (newServiceElement as HTMLInputElement).focus();
    }
  }, 100);
};

// 直接添加空按钮
const addEmptyButton = () => {
  if (isAddingButton.value) return;
  
  isAddingButton.value = true;
  const id = `custom-${Date.now()}`;
  newButtonId.value = id;
  
  const button: ButtonConfig = {
    id: id,
    name: "",
    icon: "✨",
    prompt: "",
    enabled: true,
  };
  
  config.value.buttons.push(button);
  
  // 设置焦点到新添加的按钮（可选）
  setTimeout(() => {
    const newButtonElement = document.querySelector(`[data-button-id="${id}"] input`);
    if (newButtonElement) {
      (newButtonElement as HTMLInputElement).focus();
    }
  }, 100);
};

// 优化移除服务方法
const removeService = (service: AIServiceConfig) => {
  itemToDelete.value = { type: "service", item: service };
  showDeleteConfirm.value = true;
};

// 移除按钮方法
const removeButton = (button: ButtonConfig) => {
  itemToDelete.value = { type: "button", item: button };
  showDeleteConfirm.value = true;
};

// 确认删除
const confirmDelete = () => {
  if (!itemToDelete.value) return;
  
  if (itemToDelete.value.type === "service") {
    const service = itemToDelete.value.item as AIServiceConfig;
    const index = config.value.aiServices.findIndex((s) => s.id === service.id);
    if (index > -1) {
      // 如果删除的是当前选中的服务，切换到第一个可用的服务
      const selected = getSelectedProviderModel();
      if (selected.serviceId === service.id) {
        const firstEnabled = config.value.aiServices.find(
          (s) => s.enabled && s.id !== service.id
        );
        if (firstEnabled && firstEnabled.customModels && firstEnabled.customModels.length > 0) {
          selectServiceModel(firstEnabled.id, firstEnabled.customModels[0]);
        }
      }
      config.value.aiServices.splice(index, 1);
    }
    
    // 重置添加状态，以防删除的是正在添加的服务
    if (service.id === newServiceId.value) {
      isAddingService.value = false;
      newServiceId.value = null;
    }
  } else if (itemToDelete.value.type === "button") {
    const button = itemToDelete.value.item as ButtonConfig;
    const index = config.value.buttons.findIndex((b) => b.id === button.id);
    if (index > -1) {
      config.value.buttons.splice(index, 1);
    }
    
    // 重置添加状态，以防删除的是正在添加的按钮
    if (button.id === newButtonId.value) {
      isAddingButton.value = false;
      newButtonId.value = null;
    }
  }
  
  showDeleteConfirm.value = false;
  itemToDelete.value = null;
};

// 删除模型
const removeModel = (service: AIServiceConfig, model: string) => {
  if (!service.customModels) return;

  const index = service.customModels.indexOf(model);
  if (index > -1) {
    service.customModels.splice(index, 1);
    
    // 检查当前选择的是否是被删除的模型
    const selected = getSelectedProviderModel();
    if (selected.serviceId === service.id && selected.model === model && service.customModels.length > 0) {
      // 如果是，选择第一个可用模型
      selectServiceModel(service.id, service.customModels[0]);
    }
  }
};

// 添加新的方法：更新服务配置
const updateService = (service: AIServiceConfig) => {
  const index = config.value.aiServices.findIndex((s) => s.id === service.id);
  if (index !== -1) {
    config.value.aiServices[index] = { ...service };
  }
};

// 更新按钮配置
const updateButton = (button: ButtonConfig) => {
  const index = config.value.buttons.findIndex((b) => b.id === button.id);
  if (index !== -1) {
    config.value.buttons[index] = { ...button };
  }
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

// 计算所有可用的服务-模型组合
const serviceModelOptions = computed(() => {
  const options = [];
  for (const service of config.value.aiServices) {
    if (service.enabled && service.customModels && service.customModels.length > 0) {
      for (const model of service.customModels) {
        options.push({
          value: `${service.id}:${model}`,
          label: `${service.name}:${model}`
        });
      }
    }
  }
  return options;
});

onMounted(async () => {
  try {
    await initConfig();
    // 确保 aiServices 是数组
    if (!Array.isArray(config.value.aiServices)) {
      config.value.aiServices = [];
    }
    // 确保 buttons 是数组
    if (!Array.isArray(config.value.buttons)) {
      config.value.buttons = [];
    }
  } catch (error) {
    log_error("初始化配置失败:", error);
    // 确保即使初始化失败也有默认值
    config.value.aiServices = [];
    config.value.buttons = [];
  }
});
</script>

<!-- 基础样式 - 可以添加到你的全局样式或组件样式中 -->
<style>
.form-input {
  @apply w-full rounded-md border-gray-300 bg-gray-50 shadow-sm text-base py-2.5 px-4 focus:border-blue-500 focus:ring-blue-500 focus:bg-white transition-colors;
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

/* 优化下拉框样式 */
select.form-input {
  appearance: none;
  padding-right: 2.5rem;
  padding-left: 1rem;
}

/* 添加滚动条样式 */
select.form-input option {
  padding: 8px;
  font-size: 1.1rem;
}

/* 调整内容边距 */
.config-item label {
  @apply pl-1;
}

</style>