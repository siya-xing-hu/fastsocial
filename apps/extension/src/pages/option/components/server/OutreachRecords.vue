<template>
  <section class="space-y-5">
    <header class="flex items-start justify-between gap-4"><div><h2 class="text-2xl font-semibold tracking-tight text-slate-900">{{ view.config.name }}</h2><p class="mt-1.5 text-sm text-slate-600">此 X 账户的联系记录与回关检查。</p></div><ActionButton action="back" label="返回账户列表" @click="$emit('back')" /></header>
      <div v-if="view.state.pauseReason" class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
        <div class="text-sm text-amber-900"><p class="font-medium">请求已暂停</p><p class="mt-1">{{ view.state.pauseReason }}</p></div>
        <ActionButton action="run" label="处理后恢复" :disabled="busy" @click="$emit('action', 'resume')" />
      </div>

      <div class="space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div><h3 class="font-medium text-slate-900">联系记录 <span class="text-sm font-normal text-slate-400">{{ view.records.length }}</span></h3><p class="mt-1 text-xs text-slate-500">今日已尝试关注 {{ view.todayFollowAttempts }} / {{ view.config.dailyLimit }} 人 · {{ view.config.enabled ? '自动任务已启用' : '自动任务已关闭' }}</p></div>
          <div class="flex items-center gap-2">
            <ActionButton action="refresh" label="刷新列表" :disabled="busy" @click="$emit('refresh')" />
            <ActionButton action="stop" label="停止检查" v-if="checking" :disabled="busy" @click="$emit('action', 'check/stop')" />
            <ActionButton action="test" label="检查未回关" v-else :disabled="busy || !view.config.actorId || !!view.state.pauseReason" @click="$emit('action', 'check')" />
          </div>
        </div>
        <p class="text-xs leading-5 text-slate-500">仅检查已关注且尚未确认回关的人，每检查一条更新记录。刷新列表只读取本地数据。</p>
        <p v-if="view.state.checkJob" role="status" class="text-sm text-blue-700">{{ jobLabel }}：{{ view.state.checkJob.completed }} / {{ view.state.checkJob.ids.length }}</p>
        <p v-if="view.state.nextRequestAt" class="text-xs text-slate-400">最早下次请求：{{ formatTime(view.state.nextRequestAt) }}</p>
        <div class="overflow-x-auto rounded-xl border border-slate-200">
          <table class="w-full min-w-[760px] text-left text-sm">
            <thead class="border-b border-slate-200 bg-slate-50 text-xs text-slate-500"><tr><th class="px-4 py-3 font-medium">用户 / 原帖</th><th class="px-4 py-3 font-medium">互动进度</th><th class="px-4 py-3 font-medium">回关状态</th><th class="px-4 py-3 font-medium">最近检查</th></tr></thead>
            <tbody class="divide-y divide-slate-100">
              <tr v-for="row in view.records" :key="row.id" class="align-top">
                <td class="max-w-[300px] px-4 py-4"><a :href="profileUrl(row)" target="_blank" rel="noopener noreferrer" class="font-medium text-blue-700 hover:underline">@{{ row.username }} ↗</a><p class="mt-1 truncate text-xs text-slate-500">{{ row.name }}</p><a :href="postUrl(row)" target="_blank" rel="noopener noreferrer" class="mt-2 block line-clamp-2 text-xs leading-5 text-slate-600 hover:text-blue-700" :title="row.postText">{{ row.postText }}</a><p class="mt-1 text-xs leading-5 text-slate-400">{{ row.reason }}</p></td>
                <td class="max-w-[230px] px-4 py-4"><span :class="row.stage === 'uncertain' || row.stage === 'failed' ? 'text-amber-700' : row.stage === 'done' ? 'text-emerald-700' : 'text-slate-600'">{{ stageLabels[row.stage] }}</span><p v-if="row.followedAt" class="mt-1 text-xs text-slate-400">关注于 {{ formatTime(row.followedAt) }}</p><a v-if="row.replyId" :href="`https://x.com/i/status/${encodeURIComponent(row.replyId)}`" target="_blank" rel="noopener noreferrer" class="mt-2 block text-xs text-blue-600">查看回复 ↗</a><p v-if="row.actionError" class="mt-2 text-xs leading-5 text-amber-700">{{ row.actionError }}</p></td>
                <td class="px-4 py-4"><span :class="row.following && row.followedBy ? 'text-emerald-700' : 'text-slate-600'">{{ relationshipLabel(row) }}</span><p class="mt-1 text-xs text-slate-400">{{ autoLabel(row) }}</p></td>
                <td class="max-w-[210px] px-4 py-4"><span class="text-slate-600">{{ row.checkState === 'checking' ? '检查中…' : formatTime(row.lastCheckedAt) }}</span><p v-if="row.checkError" class="mt-2 text-xs leading-5 text-amber-700">{{ row.checkError }}</p></td>
              </tr>
              <tr v-if="!view.records.length"><td colspan="4" class="px-4 py-12 text-center text-sm text-slate-400">还没有联系记录。启用此账户后，将定时浏览首页并由 AI 判断互关意图。</td></tr>
            </tbody>
          </table>
        </div>
      </div>

  </section>
</template>
<script setup lang="ts">
import ActionButton from "../../../../components/ui/ActionButton.vue";
import { computed } from 'vue';
import type { OutreachRecord, OutreachStage, OutreachView } from '@fast-social/contracts';
const props = defineProps<{ view: OutreachView; busy: boolean }>();
defineEmits<{ action: [action: 'check' | 'check/stop' | 'resume']; refresh: []; back: [] }>();
const checking = computed(() => props.view.state.checkJob?.status === 'running');
const jobLabel = computed(() => checking.value ? '正在逐条检查' : props.view.state.checkJob?.status === 'stopped' ? '检查已停止' : '检查完成');
const stageLabels: Record<OutreachStage, string> = { pending_follow: '等待关注', following: '正在关注', pending_reply: '已关注，等待回复', replying: '正在回复', done: '已关注并回复', failed: '执行失败', uncertain: '结果待确认', skipped: '已跳过' };
const formatTime = (value: string | null) => value ? new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '尚未检查';
const profileUrl = (row: OutreachRecord) => `https://x.com/${encodeURIComponent(row.username)}`;
const postUrl = (row: OutreachRecord) => `${profileUrl(row)}/status/${encodeURIComponent(row.postId)}`;
const relationshipLabel = (row: OutreachRecord) => !row.following ? row.followedAt ? '已不再关注' : '尚未确认关注' : row.followedBy === true ? '已互关' : row.followedBy === false ? '暂未回关' : '回关待检查';
const autoLabel = (row: OutreachRecord) => !row.following || row.followedBy === true ? '' : row.autoCheckAttemptAt ? '自动检查已用，后续手动检查' : row.followedAt ? '关注满一天后检查一次' : '';

</script>
