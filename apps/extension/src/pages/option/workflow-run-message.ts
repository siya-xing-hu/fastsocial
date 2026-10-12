import type { WorkflowRun } from '@fast-social/contracts';

export function workflowRunMessage(run: WorkflowRun): string {
  const counts = `扫描了 ${run.scanned} 条，AI 命中了 ${run.aiMatched} 条，处理完成了 ${run.completed} 条`;
  if (run.status === 'running') {
    return `执行中：第 ${Math.max(1, run.batch?.index ?? 1)} 批，${counts}`;
  }
  if (run.status === 'failed' || run.status === 'limited' || run.status === 'cancelled') {
    const state = { failed: '执行失败', limited: '账号请求受限', cancelled: '本次执行已停止' }[run.status];
    return `${state}：${run.error ?? ''}\n一共${counts}`;
  }
  return `执行完成：一共${counts}`;
}
