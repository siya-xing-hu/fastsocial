import type { WorkflowRun } from '@fast-social/contracts';
import type { UserWorkflowBatch } from '../monitor/monitor-runner.ts';
import type { WorkflowProgressSnapshot } from './progress.ts';

/** One durable round per workflow; individual action history remains in workflow_records. */
export interface WorkflowCheckpoint {
  configuration: string;
  revision: number;
  run: WorkflowRun;
  analysisComplete: boolean;
  recordIds: string[];
  progress?: WorkflowProgressSnapshot;
  userBatch?: UserWorkflowBatch;
}
