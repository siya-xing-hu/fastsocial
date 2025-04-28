<template>
  <div
    class="fixed inset-0 bg-gray-200 bg-opacity-75 flex items-center justify-end z-50"
    @click.self="close"
  >
    <div class="chat-panel bg-white rounded-l-lg h-full flex flex-col shadow-lg border border-gray-200 overflow-auto">
      <!-- 头部 -->
      <div class="p-4 border-b border-gray-200 flex flex-col bg-gray-50">
        <div class="flex justify-between items-center mb-2">
          <h3 class="text-lg font-medium flex items-center text-gray-800">
            <MessageSquare class="mr-2 h-5 w-5 text-blue-500" />
            <span>AI 聊天助手</span>
          </h3>
          <div class="flex gap-2">
            <button @click="clearChatHistory" class="hover:bg-red-200 p-1 rounded-full">
              <Trash2 class="h-4 w-4" />
            </button>
            <button @click="close" class="hover:bg-gray-200 p-1 rounded-full">
              <X class="h-5 w-5 text-gray-600" />
            </button>
          </div>
        </div>
        
        <!-- AI模型选择器 - 移到标题下方 -->
        <div class="relative">
          <select 
            v-model="selectedAIProvider" 
            class="chat-model-selector"
          >
            <option
              v-for="option in serviceModelOptions"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
        </div>
      </div>
      
      <!-- 聊天消息区域 -->
      <div class="flex-grow relative" ref="messagesContainer">
        <!-- 消息滚动容器 -->
        <div class="absolute inset-0 overflow-auto p-4" ref="scrollContainer" @scroll="handleScroll">
          <div v-if="messages.length === 0" class="h-full flex flex-col items-center justify-center text-gray-400">
            <MessageSquare class="h-12 w-12 mb-3" />
            <p class="text-center">开始与AI助手聊天</p>
            <p class="text-center text-sm mt-1">在下方输入问题开始对话</p>
          </div>
          
          <div v-else class="space-y-6">
            <div v-for="(message, index) in messages" :key="index" class="message-item">
              <!-- 用户消息 -->
              <div v-if="message.role === 'user'" class="flex justify-end mb-4">
                <div class="bg-blue-50 border-l-4 border-blue-400 text-gray-800 p-3 rounded-lg max-w-[80%] break-words shadow-sm">
                  <div class="flex items-start">
                    <p class="whitespace-pre-wrap flex-grow">{{ message.content }}</p>
                    <User class="h-4 w-4 ml-2 mt-1 text-blue-500 flex-shrink-0" />
                  </div>
                </div>
              </div>
              
              <!-- AI助手消息 -->
              <div v-else class="flex mb-4">
                <div class="bg-green-50 border-l-4 border-green-400 text-gray-800 p-3 rounded-lg max-w-[80%] break-words shadow-sm">
                  <div class="flex items-start">
                    <Bot class="h-4 w-4 mr-2 mt-1 text-green-600 flex-shrink-0" />
                    <MarkdownRenderer :content="message.content" class="flex-grow" />
                  </div>
                </div>
              </div>
            </div>
            
            <!-- 加载指示器 -->
            <div v-if="isLoading" class="flex items-center space-x-2 mb-4">
              <div class="bg-gray-100 p-3 rounded-lg flex items-center">
                <div class="typing-loader"></div>
              </div>
            </div>
          </div>
        </div>

        <!-- 滚动到底部按钮 - 放在滚动容器外部但仍在messagesContainer内 -->
        <button 
          v-if="showScrollToBottom" 
          @click="scrollToBottom" 
          class="absolute bottom-5 right-5 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-full p-2 shadow-md transition-all duration-200 z-50"
        >
          <ChevronsDown class="h-5 w-5" />
        </button>
      </div>
      
      <!-- 底部输入区域 -->
      <div class="border-t border-gray-200 p-2 bg-white">
        <!-- 输入框和发送按钮 -->
        <div class="flex items-end space-x-2">
          <div class="flex-grow relative">
            <textarea
              v-model="inputContent"
              class="w-full border border-gray-300 rounded-lg p-3 pr-10 resize-none bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="输入问题..."
              rows="3"
              @keydown.enter.ctrl="sendMessage"
              ref="textareaRef"
            ></textarea>
            
            <!-- 发送按钮 -->
            <button
              @click="sendMessage"
              class="absolute bottom-3 right-3 confirm-button rounded-full p-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              :disabled="isLoading || !inputContent.trim()"
            >
              <Send class="h-4 w-4" />
            </button>
          </div>
        </div>
        
        <div class="text-xs text-gray-200 mt-1 text-right">
          按 Ctrl+Enter 发送
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick, onBeforeUnmount } from "vue";
import { config } from "../../common/storage-config";
import { AIGenarateRuntimeMessage, RuntimeMessageTypeEnum, sendRuntimeMessage } from "../../common/runtime-message";
import { log_error, log_info } from "../../common/logging";
import { X, MessageSquare, Send, User, Bot, Trash2, ChevronsDown } from "lucide-vue-next";
import MarkdownRenderer from "./MarkdownRenderer.vue";

// 消息类型定义
interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: number;
  isStreaming?: boolean; // 标记当前消息是否正在进行流式输出
}

// Props 和 Emits
const props = defineProps({
  onClose: {
    type: Function,
    required: true
  }
});

// 状态变量
const inputContent = ref("");
const messages = ref<Message[]>([]);
const isLoading = ref(false);
const selectedAIProvider = ref(config.value.basic.aiProvider);
const messagesContainer = ref<HTMLElement | null>(null);
const scrollContainer = ref<HTMLElement | null>(null); // 新增滚动容器的ref
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const currentStreamRequestId = ref<string | null>(null); // 当前流式请求ID
const showScrollToBottom = ref(false); // 是否显示滚动到底部按钮
const isScrolledToBottom = ref(true); // 是否已滚动到底部

// 缓存键
const CACHE_KEY_MESSAGES = "chat_dialog_messages";
const CACHE_KEY_PROVIDER = "chat_dialog_provider";
const MAX_MESSAGES = 100; // 最多保存100条消息（50次对话）

// 计算属性：获取所有可用的服务-模型组合
const serviceModelOptions = computed(() => {
  const options = [];
  for (const service of config.value.aiServices) {
    if (service.enabled && service.customModels && service.customModels.length > 0) {
      for (const model of service.customModels) {
        options.push({
          value: `${service.id}:${model}`,
          label: `${service.name}: ${model}`
        });
      }
    }
  }
  return options;
});

// 自动滚动到底部
const scrollToBottom = async () => {
  await nextTick();
  if (scrollContainer.value) {
    scrollContainer.value.scrollTop = scrollContainer.value.scrollHeight;
    isScrolledToBottom.value = true;
    showScrollToBottom.value = false; // 滚动到底部后隐藏按钮
  }
};

// 处理滚动事件，判断是否需要显示"滚动到底部"按钮
const handleScroll = () => {
  if (!scrollContainer.value) return;
  
  const { scrollTop, scrollHeight, clientHeight } = scrollContainer.value;
  // 如果距离底部不到20px，视为已经在底部
  const isAtBottom = scrollHeight - scrollTop - clientHeight < 20;
  
  isScrolledToBottom.value = isAtBottom;
  showScrollToBottom.value = !isAtBottom && messages.value.length > 0;
};

// 发送消息
async function sendMessage() {
  if (isLoading.value || !inputContent.value.trim()) return;
  
  // 添加用户消息
  const userMessage: Message = {
    role: 'user',
    content: inputContent.value,
    timestamp: Date.now()
  };
  
  messages.value.push(userMessage);
  const userContent = inputContent.value;
  inputContent.value = "";
  
  // 滚动到底部
  await scrollToBottom();
  
  // 聚焦输入框
  if (textareaRef.value) {
    textareaRef.value.focus();
  }
  
  isLoading.value = true;
  
  try {
    const message: AIGenarateRuntimeMessage = {
      type: RuntimeMessageTypeEnum.AI_GENARATE,
      data: {
        userContent: userContent,
        aiProvider: selectedAIProvider.value,
        stream: true // 启用流式输出
      },
    };
    
    // 发送请求并等待初始响应
    log_info("发送AI生成请求");
    const response = await sendRuntimeMessage(message);
  
  } catch (error) {
    log_error("消息发送失败", error);
  }
}

// 处理流式消息的监听器
const handleStreamMessage = (message: any, sender: any, sendResponse: any) => {
  // 只处理来自后台脚本的消息
  if (sender.tab) {
    return false;
  }
  
  if (message.type === RuntimeMessageTypeEnum.AI_STREAM_START) {
    log_info("Stream started", message.data.requestId);
    currentStreamRequestId.value = message.data.requestId;
    
    // 添加一个空的助手消息
    messages.value.push({
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isStreaming: true
    });
    
    scrollToBottom();
    // 返回响应表示已处理
    sendResponse?.({ received: true });
    return true;
  }
  
  if (message.type === RuntimeMessageTypeEnum.AI_STREAM_CHUNK && 
      currentStreamRequestId.value === message.data.requestId) {
    
    // 更新最后一条消息的内容
    const lastMessage = messages.value[messages.value.length - 1];
    if (lastMessage && lastMessage.isStreaming) {
      lastMessage.content += message.data.chunk;
      scrollToBottom();
    }
    // 返回响应表示已处理
    sendResponse?.({ received: true });
    return true;
  }
  
  if (message.type === RuntimeMessageTypeEnum.AI_STREAM_END && 
      currentStreamRequestId.value === message.data.requestId) {
    
    log_info("Stream ended", message.data.requestId);
    
    // 如果有错误
    if (message.data.error) {
      log_error("Stream error", message.data.error);
      // 更新最后一条消息，标记错误
      const lastMessage = messages.value[messages.value.length - 1];
      if (lastMessage && lastMessage.isStreaming) {
        lastMessage.content += `\n\n_错误: ${message.data.error}_`;
      }
    }
    
    // 更新最后一条消息的状态
    const lastMessage = messages.value[messages.value.length - 1];
    if (lastMessage && lastMessage.isStreaming) {
      lastMessage.isStreaming = false;
    }
    
    // 重置流请求ID
    currentStreamRequestId.value = null;
    isLoading.value = false;
    
    // 保存对话历史
    saveToCache();
    // 返回响应表示已处理
    sendResponse?.({ received: true });
    return true;
  }
  
  return false;
};

// 限制消息数量，保留最新的 MAX_MESSAGES 条消息
function limitMessages() {
  if (messages.value.length > MAX_MESSAGES) {
    messages.value = messages.value.slice(messages.value.length - MAX_MESSAGES);
  }
}

// 保存到 Chrome Storage
function saveToCache() {
  // 限制消息数量
  limitMessages();
  
  // 保存到 Chrome Storage，对消息进行序列化
  chrome.storage.local.set({
    [CACHE_KEY_MESSAGES]: JSON.stringify(messages.value),
    [CACHE_KEY_PROVIDER]: selectedAIProvider.value
  });
}

// 清除聊天历史
function clearChatHistory() {
  messages.value = [];
  chrome.storage.local.remove(CACHE_KEY_MESSAGES);
}

// 从 Chrome Storage 加载数据
async function loadFromCache() {
  return new Promise<void>((resolve) => {
    chrome.storage.local.get([CACHE_KEY_MESSAGES, CACHE_KEY_PROVIDER], (result) => {
      if (result[CACHE_KEY_MESSAGES]) {
        try {
          messages.value = JSON.parse(result[CACHE_KEY_MESSAGES]);
        } catch (e) {
          log_error("解析缓存消息失败", e);
          messages.value = [];
        }
      }
      
      if (result[CACHE_KEY_PROVIDER]) {
        selectedAIProvider.value = result[CACHE_KEY_PROVIDER];
      }
      
      resolve();
    });
  });
}

// 关闭对话框
function close() {
  props.onClose();
}

// 监听消息变化
watch(messages, () => {
  saveToCache();
  // 如果用户已经滚动到底部或者正在加载中，保持滚动到底部
  if (isScrolledToBottom.value || isLoading.value) {
    scrollToBottom();
  } else {
    // 否则显示滚动到底部按钮
    showScrollToBottom.value = true;
  }
}, { deep: true });

// 监听选中的AI提供商变化
watch(selectedAIProvider, () => {
  chrome.storage.local.set({ [CACHE_KEY_PROVIDER]: selectedAIProvider.value });
});

// 组件挂载时，恢复缓存数据
onMounted(() => {
  // 移除之前的三个监听器，改用一个统一的监听器
  chrome.runtime.onMessage.addListener(handleStreamMessage);
  
  try {
    loadFromCache().then(() => {
      // 加载完缓存数据后滚动到底部
      scrollToBottom();
    });
  } catch (e) {
    log_error("解析缓存消息失败", e);
  }
  
  // 聚焦输入框
  if (textareaRef.value) {
    textareaRef.value.focus();
  }
});

// 组件卸载前移除监听器
onBeforeUnmount(() => {
  chrome.runtime.onMessage.removeListener(handleStreamMessage);
});
</script>

<style scoped>
.typing-loader {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  animation: typing 1s linear infinite alternate;
  position: relative;
  left: -12px;
}

.typing-loader::before,
.typing-loader::after {
  content: '';
  position: absolute;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  animation: typing 1s linear infinite alternate;
  top: 0;
}

.typing-loader::before {
  left: 12px;
  animation-delay: 0.2s;
}

.typing-loader::after {
  left: 24px;
  animation-delay: 0.4s;
}

@keyframes typing {
  0% {
    background-color: rgba(0,0,0,0.6);
    transform: translateY(0px);
  }
  50%, 100% {
    background-color: rgba(0,0,0,0.1);
    transform: translateY(-5px);
  }
}
</style> 