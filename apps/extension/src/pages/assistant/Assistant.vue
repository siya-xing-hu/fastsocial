<template>
  <div class="assistant-shell" @keydown.esc="historyOpen = false">
    <header class="header">
      <div class="identity"><img :src="logo" width="26" height="26" alt="" /><strong v-if="accountName" :title="accountName">{{ accountName }}</strong></div>
      <div class="actions"><ActionButton action="add" label="新会话" :disabled="busy || !ready" @click="startNew" /><ActionButton action="history" :label="historyOpen ? '返回对话' : '会话历史'" :aria-expanded="historyOpen" :disabled="busy || !ready" @click="toggleHistory" /></div>
    </header>
    <section v-if="historyOpen" class="history-view" aria-label="会话历史">
      <div class="history-heading"><h1>历史会话</h1><span>{{ history.length }}</span></div>
      <input v-model="search" class="history-search" type="search" placeholder="搜索会话" aria-label="搜索会话" />
      <div class="history-list">
        <div v-for="conversation in history" :key="conversation.id" class="history-row" :class="{ active: current.id === conversation.id }">
          <button data-ui="navigation" :title="conversation.title" class="history-item" @click="openConversation(conversation)"><strong>{{ conversation.title }}</strong><span>{{ conversation.account?.displayName || conversation.account?.username || '本地会话' }}<span>{{ dateLabel(conversation.updatedAt) }}</span></span></button>
          <ActionButton action="delete" :label="'删除会话：' + conversation.title" @click="removeConversation(conversation)" />
        </div>
        <p v-if="!history.length" class="empty-history">{{ search ? '没有找到相关会话' : '还没有历史会话' }}</p>
      </div>
      <div v-if="deleted" class="history-undo"><span>会话已删除</span><ActionButton action="reset" label="撤销删除" @click="undoDelete" /></div>
      <p v-if="error" class="feedback error" role="alert">{{ error }}</p>
    </section>
    <template v-else>
      <main ref="chatArea" class="conversation" aria-live="polite" :aria-busy="busy">
        <div v-if="!messages.length && !busy" class="welcome">
          <h1>从一个想法开始</h1>
          <div class="shortcuts">
            <button data-ui="shortcut" title="总结当前页面" v-if="skills.some(s => s.key === 'summary')" :disabled="!ready" @click="useShortcut('summary')"><AlignLeft :size="17" /><span><strong>总结</strong><small>一键读懂当前页面</small></span><code>/summary</code></button>
            <button data-ui="shortcut" title="选择发帖 Skill" v-if="skills.some(s => s.key === 'post')" :disabled="!ready" @click="useShortcut('post')"><SquarePen :size="17" /><span><strong>发帖</strong><small>写下想法，生成一条 Post</small></span><code>/post</code></button>
            <button data-ui="shortcut" title="生成当前帖子的回复" v-if="skills.some(s => s.key === 'reply')" :disabled="!ready" @click="useShortcut('reply')"><MessageCircle :size="17" /><span><strong>回复</strong><small>一键回应当前帖子</small></span><code>/reply</code></button>
          </div>
        </div>
        <article v-for="(message, index) in messages" :key="message.id" class="message" :class="message.role">
          <div v-if="message.skill" class="message-skill"><code>/{{ message.skill }}</code><span>{{ skillName(message.skill) }}</span><small v-if="message.role === 'user' && message.skillSource === 'inferred'">已匹配</small></div>
          <div v-if="message.role === 'user'" class="user-bubble">{{ message.content }}</div>
          <DraftCard v-else-if="message.skill === 'post' || message.skill === 'reply'" :message="message" :disabled="busy || !!filling" :filling="filling === message.id" @copy="copy(message.content)" @fill="fill(message)" />
          <template v-else><div class="markdown-content" v-html="renderMarkdown(message.content)" /><div class="message-actions"><ActionButton action="copy" label="复制内容" @click="copy(message.content)" /></div></template>
          <div v-if="message.error" class="message-error" role="alert"><span>{{ message.error }}</span><ActionButton v-if="index === messages.length - 1" action="refresh" label="重试生成" :disabled="busy" @click="send(message)" /></div>
        </article>
        <div v-if="busy" class="thinking"><span class="pulse" />{{ runningSkill ? '/' + runningSkill + ' · 正在生成…' : '正在思考…' }}</div>
      </main>
      <div class="composer-area">
        <p v-if="error && !messages[messages.length - 1]?.error" class="feedback error" role="alert">{{ error }}</p><p v-if="notice" class="feedback notice" role="status">{{ notice }}</p>
        <div class="compose">
          <div v-if="showCommands" id="skill-commands" class="command-menu" role="listbox" aria-label="选择 Skill">
            <button data-ui="choice" :title="item.name" v-for="(item, index) in matchingSkills" :id="'skill-option-' + index" :key="item.key" role="option" :aria-selected="selectedCommand === index" :class="{ selected: selectedCommand === index }" tabindex="-1" @mousedown.prevent @click="chooseCommand(item.key)"><span><strong>{{ item.name }}</strong><small>{{ item.description }}</small></span><code>/{{ item.key }}</code></button>
            <div class="command-hint">↑ ↓ 选择 · Enter 确认<span v-if="matchingSkills.length === 1"> · Tab 补全</span></div>
          </div>
          <textarea ref="inputElement" v-model="input" :disabled="busy || !ready" placeholder="说说你的想法，或 / 选择 Skill" aria-label="对助手说" role="combobox" aria-autocomplete="list" :aria-expanded="showCommands" aria-controls="skill-commands" :aria-activedescendant="showCommands ? 'skill-option-' + selectedCommand : undefined" rows="2" maxlength="8000" @input="saveDraft" @click="caret = inputElement?.selectionStart ?? 0" @keyup="caret = inputElement?.selectionStart ?? 0" @keydown="onKeydown" />
          <div class="compose-footer"><span>{{ !explicitSkill && lastSkill ? '上一轮 /' + lastSkill + ' · / 切换 Skill' : 'Shift + Enter 换行' }}</span><ActionButton action="send" label="发送" :disabled="busy || !ready || !input.trim()" :loading="busy" @click="send()" /></div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import MarkdownIt from 'markdown-it';
import { AlignLeft, MessageCircle, SquarePen } from 'lucide-vue-next';
import ActionButton from '../../components/ui/ActionButton.vue';
import DraftCard from './DraftCard.vue';
import logo from '../../assets/icons/icon-48.png';
import { useAssistant } from './use-assistant';
const { current, input, messages, skills, accountName, busy, ready, filling, error, notice, historyOpen, search,
  history, deleted, inputElement, chatArea, caret, showCommands, matchingSkills, selectedCommand, explicitSkill, lastSkill, runningSkill, skillName,
  startNew, openConversation, toggleHistory, removeConversation, undoDelete, chooseCommand, useShortcut,
  send, copy, fill, onKeydown, saveDraft } = useAssistant();
const markdown = new MarkdownIt({ html: false, breaks: true, linkify: true }).disable('image');
const defaultLink = markdown.renderer.rules.link_open;
markdown.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
  tokens[index].attrSet('target', '_blank'); tokens[index].attrSet('rel', 'noopener noreferrer');
  return defaultLink ? defaultLink(tokens, index, options, env, renderer) : renderer.renderToken(tokens, index, options);
};
const renderMarkdown = (content: string) => markdown.render(content);
function dateLabel(time: number) {
  const date = new Date(time);
  return date.toDateString() === new Date().toDateString() ? date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}
</script>

<style>
*{box-sizing:border-box}body{margin:0;color:#292929;background:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:13px}button,input,textarea{font:inherit}button{cursor:pointer}button:disabled{cursor:not-allowed}button:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid #8a8a8a;outline-offset:3px}button{color:inherit}a{color:inherit}.assistant-shell{height:100vh;height:100dvh;display:flex;flex-direction:column;min-width:280px}.header{display:flex;justify-content:space-between;align-items:center;padding:11px 14px;gap:10px;flex-shrink:0}.identity{display:flex;align-items:center;gap:9px;min-width:0}.identity img{flex-shrink:0}.identity strong{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.actions{display:flex;gap:6px;flex-shrink:0}.conversation{flex:1;min-height:0;overflow-y:auto;padding:18px 16px 6px;overscroll-behavior:contain}.welcome{padding:clamp(12px,8vh,70px) 2px 20px}.welcome h1{font-size:22px;font-weight:600;letter-spacing:-.5px;margin:0 0 25px}.shortcuts{display:flex;flex-direction:column;gap:8px}.shortcuts button{display:flex;align-items:center;gap:12px;width:100%;background:#fff;border:1px solid #ececec;border-radius:12px;padding:13px 12px;text-align:left}.shortcuts button:hover{background:#fafafa;border-color:#d8d8d8}.shortcuts button:disabled{opacity:.5}.shortcuts svg{color:#6d6d6d;flex-shrink:0}.shortcuts button>span{display:flex;flex-direction:column;gap:4px;min-width:0}.shortcuts strong{font-size:12px;font-weight:500}.shortcuts small{font-size:10px;color:#929292}.shortcuts code{font-family:inherit;color:#a0a0a0;font-size:10px;margin-left:auto}.message{margin:0 0 24px}.message-skill{display:flex;align-items:center;gap:6px;color:#888;font-size:10px;margin-bottom:8px}.message-skill code{font-size:11px;color:#686868}.message-skill small{font-size:9px;color:#aaa}.user{display:flex;flex-direction:column;align-items:flex-end}.user-bubble{background:#f3f3f3;padding:11px 14px;border-radius:16px 16px 4px 16px;max-width:91%;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.75;font-size:13px}.markdown-content{font-size:13px;line-height:1.85;overflow-wrap:anywhere}.markdown-content>:first-child{margin-top:0}.markdown-content>:last-child{margin-bottom:0}.markdown-content h1,.markdown-content h2,.markdown-content h3{font-size:15px;margin:20px 0 8px}.markdown-content p{margin:10px 0}.markdown-content ul,.markdown-content ol{padding-left:22px}.markdown-content pre{overflow-x:auto;padding:12px;background:#f6f6f6;border-radius:8px}.markdown-content code{font-size:12px}.markdown-content table{border-collapse:collapse;display:block;overflow-x:auto}.markdown-content td,.markdown-content th{border:1px solid #e9e9e9;padding:5px 8px}.markdown-content blockquote{border-left:2px solid #ddd;padding-left:12px;margin-left:0;color:#777}.message-actions{display:flex;gap:6px;margin-top:9px}.message-error{display:flex;align-items:center;gap:8px;font-size:11px;color:#b34d4d;line-height:1.6;margin-top:10px}.thinking{display:flex;align-items:center;gap:8px;font-size:12px;color:#888;margin:12px 0 20px}.pulse{width:6px;height:6px;border-radius:50%;background:#777;animation:pulse 1.2s ease-in-out infinite alternate}@keyframes pulse{to{opacity:.25}}.composer-area{flex-shrink:0;padding:8px 12px 12px}.compose{position:relative;border:1px solid #dedede;border-radius:17px;padding:12px 12px 9px;background:#fff;box-shadow:0 2px 8px #00000004}.compose:focus-within{border-color:#b9b9b9}.compose textarea{display:block;width:100%;resize:none;min-height:52px;max-height:180px;padding:0 2px;border:0;line-height:1.75;background:transparent;color:#333}.compose textarea:focus{outline:none}.compose textarea::placeholder{color:#a0a0a0;font-size:12px}.compose-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:6px}.compose-footer>span{font-size:10px;color:#aaa}.feedback{font-size:11px;line-height:1.6;margin:0 4px 8px;overflow-wrap:anywhere}.error{color:#b34d4d}.notice{color:#777}.command-menu{position:absolute;bottom:calc(100% + 8px);left:0;right:0;border:1px solid #e3e3e3;border-radius:13px;background:#fff;box-shadow:0 6px 25px #0000000d;padding:5px;z-index:2}.command-menu button{width:100%;display:flex;align-items:center;gap:8px;border:0;border-radius:8px;background:transparent;text-align:left;padding:11px 10px}.command-menu button.selected,.command-menu button:hover{background:#f3f3f3}.command-menu button>span{display:flex;flex-direction:column;gap:4px}.command-menu strong{font-size:12px;font-weight:500}.command-menu small{font-size:10px;color:#939393}.command-menu code{margin-left:auto;font-size:11px;color:#888}.command-hint{padding:8px 10px 4px;border-top:1px solid #f0f0f0;margin-top:3px;font-size:10px;color:#aaa}.history-view{display:flex;flex-direction:column;flex:1;min-height:0;padding:18px 14px 14px}.history-heading{display:flex;align-items:center;justify-content:space-between;margin:0 3px 18px}.history-heading h1{margin:0;font-size:18px;font-weight:600}.history-heading>span{font-size:11px;color:#aaa}.history-search{width:100%;border:1px solid #e5e5e5;border-radius:10px;background:#fafafa;padding:10px 12px;font-size:12px;margin-bottom:15px}.history-search::placeholder{color:#aaa}.history-list{overflow-y:auto;flex:1;min-height:0}.history-row{display:flex;align-items:center;gap:8px;border-radius:10px;padding:6px 8px;margin-bottom:4px}.history-row:hover,.history-row.active{background:#f5f5f5}.history-item{display:flex;flex-direction:column;gap:7px;flex:1;min-width:0;text-align:left;border:0;background:transparent;padding:6px 0}.history-item>strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:500}.history-item>span{display:flex;justify-content:space-between;gap:8px;font-size:10px;color:#999}.empty-history{font-size:12px;color:#999;text-align:center;padding:40px 10px}.history-undo{display:flex;align-items:center;justify-content:space-between;font-size:11px;color:#888;padding:8px 4px;border-top:1px solid #eee}@media(prefers-reduced-motion:reduce){.pulse{animation:none}}
</style>
