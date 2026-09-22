<template>
  <div class="markdown-content" v-html="renderedContent"></div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import MarkdownIt from 'markdown-it';

const props = defineProps({
  content: {
    type: String,
    default: ''
  }
});

// 创建Markdown解析器实例
const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  breaks: true,
  highlight: function (str: string, lang: string) {
    // 这里可以添加代码高亮功能
    return `<pre class="language-${lang}"><code>${str}</code></pre>`;
  }
});

// 计算渲染后的内容
const renderedContent = computed(() => {
  // 检测内容是否是Markdown格式
  const content = props.content || '';
  
  // 如果包含常见的Markdown特征，则进行解析
  if (
    content.includes('##') || 
    content.includes('*') || 
    content.includes('```') || 
    content.includes('[') || 
    content.includes('|') ||
    content.includes('- ')
  ) {
    return md.render(content);
  }
  
  // 如果不是Markdown格式，则保留原始的换行符
  return content.replace(/\n/g, '<br>');
});
</script>

<style>
.markdown-content {
  font-size: 0.875rem;
  line-height: 1.5;
}

.markdown-content h1 {
  font-size: 1.5rem;
  font-weight: 600;
  margin: 1.5rem 0 1rem;
  border-bottom: 1px solid #eee;
  padding-bottom: 0.3rem;
}

.markdown-content h2 {
  font-size: 1.3rem;
  font-weight: 600;
  margin: 1.5rem 0 1rem;
  border-bottom: 1px solid #eee;
  padding-bottom: 0.3rem;
}

.markdown-content h3 {
  font-size: 1.1rem;
  font-weight: 600;
  margin: 1.2rem 0 0.8rem;
}

.markdown-content h4, .markdown-content h5, .markdown-content h6 {
  font-size: 1rem;
  font-weight: 600;
  margin: 1rem 0 0.8rem;
}

.markdown-content p {
  margin: 0.5rem 0;
}

.markdown-content ul, .markdown-content ol {
  padding-left: 1.5rem;
  margin: 0.5rem 0;
}

.markdown-content ul {
  list-style-type: disc;
}

.markdown-content ol {
  list-style-type: decimal;
}

.markdown-content li {
  margin: 0.25rem 0;
}

.markdown-content code {
  background: #f3f4f6;
  padding: 0.2rem 0.4rem;
  border-radius: 0.25rem;
  font-family: monospace;
  font-size: 0.85rem;
}

.markdown-content pre {
  background: #f3f4f6;
  padding: 1rem;
  border-radius: 0.25rem;
  overflow: auto;
  margin: 1rem 0;
}

.markdown-content pre code {
  background: none;
  padding: 0;
  border-radius: 0;
  font-size: 0.85rem;
}

.markdown-content blockquote {
  border-left: 4px solid #e5e7eb;
  padding-left: 1rem;
  color: #6b7280;
  margin: 1rem 0;
}

.markdown-content a {
  color: #3b82f6;
  text-decoration: none;
}

.markdown-content a:hover {
  text-decoration: underline;
}

.markdown-content th, .markdown-content td {
  border: 1px solid #e5e7eb;
  padding: 0.5rem;
  text-align: left;
}

.markdown-content th {
  background: #f9fafb;
  font-weight: 600;
}

.markdown-content tr:nth-child(even) {
  background: #f9fafb;
}
</style> 