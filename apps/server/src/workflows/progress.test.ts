import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkflowRun } from '@fast-social/contracts';
import { WorkflowProgress } from './progress.ts';

test('review updates matching totals without counting posts twice and actions retain their original batch', () => {
  const run: WorkflowRun = { id: 'r', workflowId: 'w', status: 'running', scanned: 0, aiMatched: 0, checked: 0, matched: 0, completed: 0, error: null, startedAt: '', finishedAt: null };
  const progress = new WorkflowProgress(run);
  progress.report({ index: 1, phase: 'analyze', postIds: ['1'], decisions: [{ postId: '1', matched: false }] });
  progress.report({ index: 2, phase: 'analyze', postIds: ['2'], decisions: [{ postId: '2', matched: true }] });
  progress.report({ index: 3, phase: 'review', postIds: ['1'], decisions: [{ postId: '1', matched: true }] });
  assert.deepEqual([run.checked, run.matched], [2, 2]);
  assert.deepEqual([run.scanned, run.aiMatched], [2, 2]);
  progress.actions('1'); progress.complete('1'); progress.complete('1');
  assert.deepEqual(run.batch, { index: 1, total: 1, checked: 1, matched: 1, completed: 1 });
  assert.equal(run.completed, 1);
});

test('follow workflow hits count confirmed new follows even when a later reply fails', () => {
  const run: WorkflowRun = { id: 'r', workflowId: 'w', status: 'running', scanned: 0, aiMatched: 0, checked: 0, matched: 0, completed: 0, error: null, startedAt: '', finishedAt: null };
  const progress = new WorkflowProgress(run, true);
  progress.scan(['1', '2', 'excluded', 'excluded']);
  assert.deepEqual([run.scanned, run.checked, run.aiMatched], [3, 0, 0]);
  progress.report({ index: 1, phase: 'analyze', postIds: ['1', '2'], decisions: [{ postId: '1', matched: true }, { postId: '2', matched: true }] });
  assert.equal(run.checked, 2); assert.equal(run.matched, 0);
  assert.deepEqual([run.scanned, run.aiMatched], [3, 2]);
  progress.actions('1'); progress.followed('1'); progress.followed('1');
  assert.equal(run.matched, 1); assert.equal(run.completed, 0); assert.equal(run.batch?.matched, 1);
  assert.equal(run.aiMatched, 2);
});
