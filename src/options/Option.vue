<template>
  <div class="flex min-h-screen relative">
    <!-- 左侧导航 -->
    <aside class="w-[200px] bg-gray-100 p-5">
      <div v-for="item in menuItems" :key="item.key" :class="[
        'p-2.5 cursor-pointer rounded',
        currentMenu === item.key ? 'bg-gray-200' : ''
      ]" @click="currentMenu = item.key">
        {{ item.label }}
      </div>
    </aside>

    <!-- 右侧配置区域 -->
    <main class="flex-1 p-8">
      <!-- 基础配置 -->
      <section v-if="currentMenu === 'basic'">
        <h2>基础配置</h2>

        <div class="mb-5">
          <!-- 复用 Popup 中的配置 -->
          <div class="config-item">
            <label>默认AI服务</label>
            <select v-model="config.basic.aiProvider" class="pl-3">
              <option value="chatgpt">ChatGPT</option>
              <option value="ollama">Ollama</option>
            </select>
          </div>

          <div class="config-item">
            <label>默认翻译服务</label>
            <select v-model="config.basic.provider" class="pl-3">
              <option value="google">Google 翻译</option>
              <option value="deepl">DeepL</option>
              <option value="chatgpt">ChatGPT</option>
              <option value="ollama">Ollama</option>
            </select>
          </div>

          <div class="config-item">
            <label>目标语言</label>
            <select v-model="config.basic.targetLang">
              <option value="zh">中文</option>
              <option value="en">英文</option>
              <!-- 其他语言选项 -->
            </select>
          </div>

          <!-- 快捷键配置 -->
          <div class="config-item">
            <label>翻译快捷键</label>
            <div class="shortcut-input pl-3">
              <input type="checkbox" v-model="config.basic.shortcut.ctrl"> Ctrl
              <input type="checkbox" v-model="config.basic.shortcut.shift"> Shift
            </div>
          </div>


          <div class="mt-3 text-sm px-1 text-gray-2">
            <div class="flex items-center justify-between">
              <div class="flex items-center">
                <label class="mb-0 mr-2 shrink-0">自动翻译</label>
              </div>
              <input type="checkbox" v-model="config.basic.autoTranslate" role="switch"
                class="shrink-0 w-9 h-3">
            </div>
          </div>
        </div>
      </section>

      <!-- AI 服务配置 -->
      <section v-if="currentMenu === 'ai'">
        <h2>AI 服务配置</h2>

        <!-- OpenAI 配置 -->
        <div class="mb-8 p-5 border border-gray-200 rounded-lg">
          <h3>OpenAI</h3>
          <div class="mb-5">
            <div class="config-item">
              <label>API Key</label>
              <input type="password" v-model="config.aiService.openai.apiKey">
            </div>
            <div class="config-item">
              <label>组织 ID</label>
              <input type="text" v-model="config.aiService.openai.org">
            </div>
            <div class="config-item">
              <label>模型</label>
              <select v-model="config.aiService.openai.model">
                <option value="gpt-3.5-turbo">GPT-3.5</option>
                <option value="gpt-4">GPT-4</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Ollama 配置 -->
        <div class="mb-8 p-5 border border-gray-200 rounded-lg">
          <h3>Ollama</h3>
          <div class="mb-5">
            <div class="config-item">
              <label>服务地址</label>
              <input type="text" v-model="config.aiService.ollama.endpoint">
            </div>
            <div class="config-item">
              <label>模型</label>
              <input type="text" v-model="config.aiService.ollama.model">
            </div>
          </div>
        </div>
      </section>

      <!-- 保存按钮 -->
      <div class="fixed bottom-8 right-8">
        <button @click="saveConfig" class="px-6 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
          保存配置
        </button>
      </div>
    </main>
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

// 保存配置方法
const saveConfig = () => {
  onInput();
}

onMounted(async () => {
  await initConfig();
});
</script>
