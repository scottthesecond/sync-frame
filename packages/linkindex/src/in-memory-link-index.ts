/**
 * InMemoryLinkIndex - An in-memory implementation of LinkIndex for testing.
 * Stores links, cursors, job state, run logs, conflicts, and fail counts in memory.
 */

import type {
  LinkIndex,
  Cursor,
  RunSummary,
  Conflict,
} from "@syncframe/core";

/**
 * In-memory link index that stores all data in memory.
 * Useful for testing and development without database dependencies.
 */
export class InMemoryLinkIndex implements LinkIndex {
  // Bidirectional link storage using composite keys
  // Key format: `${sourceAdapter}:${sourceTable}:${sourceId}` -> `${destAdapter}:${destTable}:${destId}`
  private sourceToDest: Map<string, string>;
  private destToSource: Map<string, string>;

  // Cursor storage: key is `${jobId}:${adapter}:${table}`
  private cursors: Map<string, Cursor>;

  // Fail count storage: key is `${jobId}:${adapter}:${table}`
  private failCounts: Map<string, number>;

  // Job disabled state: key is jobId, value is disabled timestamp
  private disabledJobs: Map<string, Date>;

  // Run logs: key is runId
  private runs: Map<string, RunSummary>;

  // Conflicts: key is conflictId
  private conflicts: Map<string, Conflict>;

  constructor() {
    this.sourceToDest = new Map();
    this.destToSource = new Map();
    this.cursors = new Map();
    this.failCounts = new Map();
    this.disabledJobs = new Map();
    this.runs = new Map();
    this.conflicts = new Map();
  }

  /**
   * Create a composite key for source records.
   */
  private sourceKey(adapter: string, table: string, id: string): string {
    return `${adapter}:${table}:${id}`;
  }

  /**
   * Create a composite key for destination records.
   */
  private destKey(adapter: string, table: string, id: string): string {
    return `${adapter}:${table}:${id}`;
  }

  /**
   * Store or update a link between a source record and destination record.
   */
  async upsertLink(
    sourceAdapter: string,
    sourceTable: string,
    sourceId: string,
    destAdapter: string,
    destTable: string,
    destId: string
  ): Promise<void> {
    const sourceKey = this.sourceKey(sourceAdapter, sourceTable, sourceId);
    const destKey = this.destKey(destAdapter, destTable, destId);

    // Remove old links if they exist
    const oldDest = this.sourceToDest.get(sourceKey);
    if (oldDest) {
      this.destToSource.delete(oldDest);
    }

    const oldSource = this.destToSource.get(destKey);
    if (oldSource) {
      this.sourceToDest.delete(oldSource);
    }

    // Create new bidirectional links
    this.sourceToDest.set(sourceKey, destKey);
    this.destToSource.set(destKey, sourceKey);
  }

  /**
   * Find the destination ID for a given source ID.
   */
  async findDest(
    sourceAdapter: string,
    sourceTable: string,
    sourceId: string
  ): Promise<string | null> {
    const sourceKey = this.sourceKey(sourceAdapter, sourceTable, sourceId);
    const destKey = this.sourceToDest.get(sourceKey);
    
    if (!destKey) {
      return null;
    }

    // Extract just the ID from the composite key (format: "adapter:table:id")
    const parts = destKey.split(":");
    return parts.length >= 3 ? parts.slice(2).join(":") : null;
  }

  /**
   * Find the source ID for a given destination ID.
   */
  async findSource(
    destAdapter: string,
    destTable: string,
    destId: string
  ): Promise<string | null> {
    const destKey = this.destKey(destAdapter, destTable, destId);
    const sourceKey = this.destToSource.get(destKey);
    
    if (!sourceKey) {
      return null;
    }

    // Extract just the ID from the composite key (format: "adapter:table:id")
    const parts = sourceKey.split(":");
    return parts.length >= 3 ? parts.slice(2).join(":") : null;
  }

  /**
   * Load the last known cursor for a job, adapter, and table.
   */
  async loadCursor(jobId: string, adapter: string, table: string): Promise<Cursor> {
    const key = `${jobId}:${adapter}:${table}`;
    const cursor = this.cursors.get(key);
    return cursor ? { ...cursor } : { value: null };
  }

  /**
   * Save a cursor for a job, adapter, and table.
   */
  async saveCursor(
    jobId: string,
    adapter: string,
    table: string,
    cursor: Cursor
  ): Promise<void> {
    const key = `${jobId}:${adapter}:${table}`;
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
   * Increment the fail count for a specific cursor.
   */
  async incrementFailCount(
    jobId: string,
    adapter: string,
    table: string
  ): Promise<number> {
    const key = `${jobId}:${adapter}:${table}`;
    const current = this.failCounts.get(key) || 0;
    const newCount = current + 1;
    this.failCounts.set(key, newCount);
    return newCount;
  }

  /**
   * Reset the fail count for a specific cursor.
   */
  async resetFailCount(jobId: string, adapter: string, table: string): Promise<void> {
    const key = `${jobId}:${adapter}:${table}`;
    this.failCounts.delete(key);
  }

  /**
   * Get the current fail count for a specific cursor.
   */
  async getFailCount(jobId: string, adapter: string, table: string): Promise<number> {
    const key = `${jobId}:${adapter}:${table}`;
    return this.failCounts.get(key) || 0;
  }

  /**
   * Insert a conflict record for manual resolution.
   */
  async insertConflict(conflict: Conflict): Promise<void> {
    this.conflicts.set(conflict.conflictId, { ...conflict });
  }

  /**
   * Get all unresolved conflicts for a job.
   */
  async getConflicts(jobId: string): Promise<Conflict[]> {
    return Array.from(this.conflicts.values()).filter(
      (conflict) => conflict.jobId === jobId
    );
  }

  /**
   * Mark a conflict as resolved (delete it).
   */
  async resolveConflict(conflictId: string): Promise<void> {
    this.conflicts.delete(conflictId);
  }

  /**
   * Insert a summary record for a sync run.
   */
  async insertRun(run: RunSummary): Promise<void> {
    this.runs.set(run.runId, { ...run });
  }

  // --- Helper methods for testing/debugging ---

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
   * Returns simplified format with just IDs (not full composite keys).
   */
  getAllLinks(): Array<{
    sourceAdapter: string;
    sourceTable: string;
    sourceId: string;
    destAdapter: string;
    destTable: string;
    destId: string;
  }> {
    const links: Array<{
      sourceAdapter: string;
      sourceTable: string;
      sourceId: string;
      destAdapter: string;
      destTable: string;
      destId: string;
    }> = [];

    for (const [sourceKey, destKey] of this.sourceToDest.entries()) {
      const sourceParts = sourceKey.split(":");
      const destParts = destKey.split(":");

      if (sourceParts.length >= 3 && destParts.length >= 3) {
        links.push({
          sourceAdapter: sourceParts[0],
          sourceTable: sourceParts[1],
          sourceId: sourceParts.slice(2).join(":"),
          destAdapter: destParts[0],
          destTable: destParts[1],
          destId: destParts.slice(2).join(":"),
        });
      }
    }

    return links;
  }

  /**
   * Get all conflicts (useful for testing/debugging).
   */
  getAllConflicts(): Conflict[] {
    return Array.from(this.conflicts.values());
  }

  /**
   * Clear all data (useful for testing/debugging).
   */
  clear(): void {
    this.sourceToDest.clear();
    this.destToSource.clear();
    this.cursors.clear();
    this.failCounts.clear();
    this.disabledJobs.clear();
    this.runs.clear();
    this.conflicts.clear();
  }

  /**
   * Enable a previously disabled job (useful for testing/debugging).
   */
  enableJob(jobId: string): void {
    this.disabledJobs.delete(jobId);
  }
}
