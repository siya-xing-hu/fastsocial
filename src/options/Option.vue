<template>
  <div class="flex min-h-screen bg-gray-50">
    <!-- 左侧导航 - 添加固定宽度和阴影 -->
    <aside class="fixed w-[200px] h-full bg-white shadow-sm border-r border-gray-200">
      <div class="py-6 px-3">
        <h1 class="text-xl font-medium px-3 mb-6">设置</h1>
        <div v-for="item in menuItems" :key="item.key" :class="[
          'px-3 py-2 mb-1 rounded-md cursor-pointer text-gray-600 hover:bg-gray-100',
          currentMenu === item.key ? 'bg-gray-100 text-gray-900' : ''
        ]" @click="currentMenu = item.key">
          {{ item.label }}
        </div>
      </div>
    </aside>

    <!-- 右侧配置区域 -->
    <main class="flex-1 ml-[200px] p-8">
      <!-- 基础配置 -->
      <section v-if="currentMenu === 'basic'" class="max-w-2xl">
        <h2 class="text-xl font-medium mb-6">基础配置</h2>

        <div class="space-y-6 bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <!-- 配置项样式优化 -->
          <div class="config-item">
            <label class="block text-sm font-medium text-gray-700 mb-2">默认AI服务</label>
            <select v-model="config.basic.aiProvider"
              class="form-input">
              <option value="chatgpt">ChatGPT</option>
              <option value="ollama">Ollama</option>
            </select>
          </div>

          <div class="config-item">
            <label class="block text-sm font-medium text-gray-700 mb-2">默认翻译服务</label>
            <select v-model="config.basic.provider"
              class="form-input">
              <option value="google">Google 翻译</option>
              <option value="deepl">DeepL</option>
              <option value="chatgpt">ChatGPT</option>
              <option value="ollama">Ollama</option>
            </select>
          </div>

          <div class="config-item">
            <label class="block text-sm font-medium text-gray-700 mb-2">目标语言</label>
            <select v-model="config.basic.targetLang"
              class="form-input">
              <option value="zh">中文</option>
              <option value="en">英文</option>
            </select>
          </div>

          <!-- 快捷键配置 -->
          <div class="config-item">
            <label class="block text-sm font-medium text-gray-700 mb-2">翻译快捷键</label>
            <div class="flex gap-4">
              <label class="inline-flex items-center">
                <input type="checkbox" v-model="config.basic.shortcut.ctrl"
                  class="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-500 focus:ring-blue-500">
                <span class="ml-2 text-sm text-gray-600">Ctrl</span>
              </label>
              <label class="inline-flex items-center">
                <input type="checkbox" v-model="config.basic.shortcut.shift"
                  class="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-500 focus:ring-blue-500">
                <span class="ml-2 text-sm text-gray-600">Shift</span>
              </label>
            </div>
          </div>

          <!-- 开关样式优化 -->
          <div class="flex items-center justify-between py-2">
            <label class="text-sm font-medium text-gray-700">自动翻译</label>
            <label class="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" v-model="config.basic.autoTranslate" class="sr-only peer">
              <div
                class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600">
              </div>
            </label>
          </div>
        </div>
      </section>

      <!-- AI 服务配置 -->
      <section v-if="currentMenu === 'ai'" class="max-w-2xl">
        <h2 class="text-xl font-medium mb-6">AI 服务配置</h2>

        <!-- OpenAI 配置 -->
        <div class="mb-6 bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <h3 class="text-lg font-medium mb-4">OpenAI</h3>
          <div class="space-y-4">
            <div class="config-item">
              <label class="block text-sm font-medium text-gray-700 mb-2">API Key</label>
              <input type="password" v-model="config.aiService.openai.apiKey"
                class="form-input">
            </div>
            <div class="config-item">
              <label class="block text-sm font-medium text-gray-700 mb-2">组织 ID</label>
              <input type="text" v-model="config.aiService.openai.org"
                class="form-input">
            </div>
            <div class="config-item">
              <label class="block text-sm font-medium text-gray-700 mb-2">模型</label>
              <select v-model="config.aiService.openai.model"
                class="form-input">
                <option value="gpt-3.5-turbo">GPT-3.5</option>
                <option value="gpt-4">GPT-4</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Ollama 配置 -->
        <div class="mb-6 bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <h3 class="text-lg font-medium mb-4">Ollama</h3>
          <div class="space-y-4">
            <div class="config-item">
              <label class="block text-sm font-medium text-gray-700 mb-2">服务地址</label>
              <input type="text" v-model="config.aiService.ollama.endpoint"
                class="form-input">
            </div>
            <div class="config-item">
              <label class="block text-sm font-medium text-gray-700 mb-2">模型</label>
              <div class="flex gap-2">
                <select v-model="config.aiService.ollama.model"
                        class="form-input flex-1">
                  <!-- 默认模型列表 -->
                  <option value="llama3">Llama 3</option>
                  <!-- 用户自定义模型 -->
                  <option disabled>──────────</option>
                  <option v-for="model in config.aiService.ollama.customModels" 
                          :key="model" 
                          :value="model">
                    {{ model }}
                  </option>
                </select>
                <button @click="showAddModel = true" 
                        class="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-md text-gray-600 transition-colors">
                  添加模型
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- 保存按钮 -->
      <div class="fixed bottom-8 right-8">
        <button @click="saveConfig"
          class="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-sm transition-colors">
          保存配置
        </button>
      </div>
    </main>
  </div>

  <!-- 添加模型对话框 -->
  <div v-if="showAddModel" 
       class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
    <div class="bg-white rounded-lg p-6 w-[400px]">
      <h3 class="text-lg font-medium mb-4">添加自定义模型</h3>
      <input type="text" 
             v-model="newModelName" 
             placeholder="请输入模型名称"
             class="form-input mb-4">
      <div class="flex justify-end gap-2">
        <button @click="showAddModel = false" 
                class="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md transition-colors">
          取消
        </button>
        <button @click="addCustomModel" 
                class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors">
          确定
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { config, initConfig, onInput } from '../config/storage-config';

const currentMenu = ref('basic')
const menuItems = [
  { key: 'basic', label: '基础配置' },
  { key: 'ai', label: 'AI 服务' },
  // 可以添加更多配置项
]

const showAddModel = ref(false);
const newModelName = ref('');

// 保存配置方法
const saveConfig = () => {
  onInput();
}

onMounted(async () => {
  await initConfig();
});

// 添加自定义模型
const addCustomModel = () => {
  if (newModelName.value) {
    if (!config.value.aiService.ollama.customModels) {
      config.value.aiService.ollama.customModels = [];
    }
    config.value.aiService.ollama.customModels.push(newModelName.value);
    newModelName.value = '';
    showAddModel.value = false;
  }
}
</script>

<!-- 基础样式 - 可以添加到你的全局样式或组件样式中 -->
<style>
.form-input {
  @apply w-full rounded-md border-gray-300 bg-gray-50 shadow-sm text-base py-2.5
  focus:border-blue-500 focus:ring-blue-500 focus:bg-white transition-colors;
}
</style>
