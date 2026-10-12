import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkflowRun } from '@fast-social/contracts';
import { workflowRunMessage } from './workflow-run-message.ts';

test('progress shows the current batch and cumulative scan, AI match and completion counts', () => {
  const run: WorkflowRun = { id: 'r', workflowId: 'w', accountName: '执行账号', status: 'running', phase: 'analyze',
    scanned: 20, aiMatched: 0, checked: 0, matched: 0, completed: 0, error: null, startedAt: '', finishedAt: null,
    batch: { index: 1, total: 20, checked: 0, matched: 0, completed: 0 } };
  assert.equal(workflowRunMessage(run), '执行中：第 1 批，扫描了 20 条，AI 命中了 0 条，处理完成了 0 条');
  Object.assign(run, { phase: 'actions', scanned: 40, aiMatched: 6, checked: 40, matched: 3, completed: 2,
    batch: { index: 2, total: 20, checked: 20, matched: 1, completed: 0 } });
  assert.equal(workflowRunMessage(run), '执行中：第 2 批，扫描了 40 条，AI 命中了 6 条，处理完成了 2 条');
  Object.assign(run, { status: 'failed', error: 'Cloudflare 拒绝查询' });
  assert.equal(workflowRunMessage(run), '执行失败：Cloudflare 拒绝查询\n一共扫描了 40 条，AI 命中了 6 条，处理完成了 2 条');
  assert.equal(workflowRunMessage({ ...run, status: 'done', batch: undefined }), '执行完成：一共扫描了 40 条，AI 命中了 6 条，处理完成了 2 条');
  for (const status of ['limited', 'cancelled'] as const)
    assert.ok(workflowRunMessage({ ...run, status }).endsWith('一共扫描了 40 条，AI 命中了 6 条，处理完成了 2 条'));
});

test('fetching, learning and deferred work retain the same compact counter format', () => {
  const run: WorkflowRun = { id: 'r', workflowId: 'w', status: 'running', phase: 'fetch',
    scanned: 0, aiMatched: 0, checked: 0, matched: 0, completed: 0, error: null, startedAt: '', finishedAt: null };
  assert.equal(workflowRunMessage(run), '执行中：第 1 批，扫描了 0 条，AI 命中了 0 条，处理完成了 0 条');
  assert.equal(workflowRunMessage({ ...run, scanned: 20, checked: 20, phase: 'learn', status: 'done' }),
    '执行完成：一共扫描了 20 条，AI 命中了 0 条，处理完成了 0 条');
  assert.ok(workflowRunMessage({ ...run, batch: { index: 0, total: 1, checked: 1, matched: 1, completed: 0 } }).startsWith('执行中：第 1 批'));
});
