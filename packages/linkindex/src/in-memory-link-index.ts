/**
 * InMemoryLinkIndex - An in-memory implementation of LinkIndex for testing.
 * Stores links, cursors, job state, and run logs in memory.
 */

import type {
  LinkIndex,
  Cursor,
  RunSummary,
  SideKey,
} from "@syncframe/core";

/**
 * In-memory link index that stores all data in memory.
 * Useful for testing and development without database dependencies.
 */
export class InMemoryLinkIndex implements LinkIndex {
  // Bidirectional link storage: sourceId -> destId and destId -> sourceId
  private sourceToDest: Map<string, string>;
  private destToSource: Map<string, string>;

  // Cursor storage: key is `${jobId}:${side}`
  private cursors: Map<string, Cursor>;

  // Job disabled state: key is jobId, value is disabled timestamp
  private disabledJobs: Map<string, Date>;

  // Run logs: key is runId
  private runs: Map<string, RunSummary>;

  constructor() {
    this.sourceToDest = new Map();
    this.destToSource = new Map();
    this.cursors = new Map();
    this.disabledJobs = new Map();
    this.runs = new Map();
  }

  /**
   * Store or update a link between a source record and destination record.
   */
  async upsertLink(sourceId: string, destId: string): Promise<void> {
    // Remove old links if they exist
    const oldDest = this.sourceToDest.get(sourceId);
    if (oldDest) {
      this.destToSource.delete(oldDest);
    }

    const oldSource = this.destToSource.get(destId);
    if (oldSource) {
      this.sourceToDest.delete(oldSource);
    }

    // Create new bidirectional links
    this.sourceToDest.set(sourceId, destId);
    this.destToSource.set(destId, sourceId);
  }

  /**
   * Find the destination ID for a given source ID.
   */
  async findDest(sourceId: string): Promise<string | null> {
    return this.sourceToDest.get(sourceId) ?? null;
  }

  /**
   * Find the source ID for a given destination ID.
   */
  async findSource(destId: string): Promise<string | null> {
    return this.destToSource.get(destId) ?? null;
  }

  /**
   * Load the last known cursor for a job and side.
   */
  async loadCursor(jobId: string, side: SideKey): Promise<Cursor> {
    const key = `${jobId}:${side}`;
    const cursor = this.cursors.get(key);
    return cursor ?? { value: null };
  }

  /**
   * Save a cursor for a job and side.
   */
  async saveCursor(jobId: string, side: SideKey, cursor: Cursor): Promise<void> {
    const key = `${jobId}:${side}`;
    this.cursors.set(key, { ...cursor });
  }

  /**
   * Mark a job as disabled at the given timestamp.
   */
  async setJobDisabled(jobId: string, ts: Date): Promise<void> {
    this.disabledJobs.set(jobId, ts);
  }

  /**
   * Check if a job is currently disabled.
   */
  async isJobDisabled(jobId: string): Promise<boolean> {
    return this.disabledJobs.has(jobId);
  }

  /**
   * Insert a summary record for a sync run.
   */
  async insertRun(run: RunSummary): Promise<void> {
    this.runs.set(run.runId, { ...run });
  }

  /**
   * Get all runs for a job (useful for testing/debugging).
   */
  getRunsForJob(jobId: string): RunSummary[] {
    return Array.from(this.runs.values()).filter((run) => run.jobId === jobId);
  }

  /**
   * Get all runs (useful for testing/debugging).
   */
  getAllRuns(): RunSummary[] {
    return Array.from(this.runs.values());
  }

  /**
   * Get a specific run by ID (useful for testing/debugging).
   */
  getRun(runId: string): RunSummary | undefined {
    return this.runs.get(runId);
  }

  /**
   * Get all links (useful for testing/debugging).
   */
  getAllLinks(): Array<{ sourceId: string; destId: string }> {
    return Array.from(this.sourceToDest.entries()).map(([sourceId, destId]) => ({
      sourceId,
      destId,
    }));
  }

  /**
   * Clear all data (useful for testing/debugging).
   */
  clear(): void {
    this.sourceToDest.clear();
    this.destToSource.clear();
    this.cursors.clear();
    this.disabledJobs.clear();
    this.runs.clear();
  }

  /**
   * Enable a previously disabled job (useful for testing/debugging).
   */
  enableJob(jobId: string): void {
    this.disabledJobs.delete(jobId);
  }
}

