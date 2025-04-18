<template>
  <div
    class="fixed inset-0 bg-gray-200 bg-opacity-75 flex justify-center items-center"
  >
    <div class="bg-theme p-6 rounded-lg shadow-md w-96 relative">
      <!-- 关闭按钮 -->
      <div class="absolute top-0 left-0 p-2">
        <button @click="cancel" class="text-gray-600 hover:text-gray-800">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
      <!-- 标题和内容 -->
      <div class="text-center">
        <span class="font-semibold text-gray-700">AI Generate</span>
        <p class="mt-2">{{ text }}</p>
      </div>
      <div class="flex justify-around mt-6">
        <button
          @click="confirm"
          class="bg-blue-400 hover:bg-blue-500  font-thin py-1 px-2 rounded-md m-0.5"
        >
          Confirm
        </button>
        <button
          @click="cancel"
          class="bg-gray-400 hover:bg-gray-500  font-thin py-1 px-2 rounded-md m-0.5"
        >
          Cancel
        </button>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, onMounted, onUnmounted, ref } from "vue";
import { setupThemeObserver, ThemeColors } from "../../utils/themeManager";

export default defineComponent({
  name: "Dialog",
  props: {
    text: String,
  },
  setup() {
    // 创建一个引用存储清理函数
    const cleanup = ref<(() => void) | null>(null);

    onMounted(() => {
      // 组件挂载时设置主题观察器
      cleanup.value = setupThemeObserver();
    });

    onUnmounted(() => {
      // 组件卸载时清理观察器
      if (cleanup.value) {
        cleanup.value();
      }
    });

    return {
      // 这里不返回任何方法，因为它们会在methods中定义
    };
  },
  methods: {
    confirm() {
      this.$emit("confirm");
    },
    cancel() {
      this.$emit("cancel");
    },
  },
});
</script>

<style>
.bg-theme {
  /* 默认样式，会被JavaScript动态覆盖 */
  background-color: #ffffff;
  transition: background-color 0.3s ease, color 0.3s ease;
}

/* 这里可以添加一些 CSS 样式，或者使用 Tailwind CSS 类 */
</style>
