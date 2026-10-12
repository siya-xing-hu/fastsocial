import type { WorkflowRun } from '@fast-social/contracts';

export interface AnalysisProgress {
  index: number;
  phase: 'analyze' | 'learn' | 'review';
  postIds: string[];
  decisions?: { postId: string; matched: boolean }[];
}
export type ReportAnalysisProgress = (progress: AnalysisProgress) => void;

/** Follow workflows count confirmed new relationships as hits; other workflows count AI matches. */
export class WorkflowProgress {
  private batches = new Map<number, { index: number; postIds: string[] }>();
  private examined = new Set<string>();
  private scanned = new Set<string>();
  private decisions = new Map<string, boolean>();
  private completed = new Set<string>();
  private confirmedFollows = new Set<string>();
  private current?: { index: number; postIds: string[] };
  private readonly run: WorkflowRun;
  private readonly requireNewFollow: boolean;
  constructor(run: WorkflowRun, requireNewFollow = false) { this.run = run; this.requireNewFollow = requireNewFollow; }

  report = (update: AnalysisProgress): void => {
    for (const id of update.postIds) this.scanned.add(id);
    this.run.phase = update.phase;
    this.current = { index: update.index, postIds: [...new Set(update.postIds)] };
    if (update.phase !== 'review') this.batches.set(update.index, this.current);
    if (update.decisions) {
      for (const id of update.postIds) this.examined.add(id);
      for (const decision of update.decisions) this.decisions.set(decision.postId, decision.matched);
    }
    this.sync();
  };
  scan = (postIds: string[]): void => {
    for (const id of postIds) this.scanned.add(id);
    this.sync();
  };
  actions(postId: string): void {
    this.run.phase = 'actions';
    this.current = [...this.batches.values()].find(batch => batch.postIds.includes(postId));
    this.sync();
  }
  complete(postId: string): void { this.completed.add(postId); this.sync(); }
  followed(postId: string): void { this.confirmedFollows.add(postId); this.sync(); }
  private matched(postId: string): boolean { return this.requireNewFollow ? this.confirmedFollows.has(postId) : !!this.decisions.get(postId); }
  private sync(): void {
    this.run.scanned = this.scanned.size;
    this.run.aiMatched = [...this.decisions.values()].filter(Boolean).length;
    this.run.checked = this.examined.size;
    this.run.matched = [...this.decisions.keys()].filter(id => this.matched(id)).length;
    this.run.completed = this.completed.size;
    this.run.batch = this.current ? { index: this.current.index, total: this.current.postIds.length,
      checked: this.current.postIds.filter(id => this.examined.has(id)).length,
      matched: this.current.postIds.filter(id => this.matched(id)).length,
      completed: this.current.postIds.filter(id => this.completed.has(id)).length } : undefined;
  }
}
