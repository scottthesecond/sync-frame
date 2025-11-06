/**
 * SyncEngine - Core bidirectional sync orchestration.
 * Implements the pull-map-push-persist loop with retry and throttle logic.
 */

import {
  SourceAdapter,
  Mapper,
  LinkIndex,
  Cursor,
  ChangeSet,
  RunSummary,
  SideKey,
  Record as SyncRecord,
  RecordID,
} from "./types.js";

/**
 * Configuration for a single side of a sync job.
 */
export interface SideConfig {
  adapter: SourceAdapter;
  sideKey: SideKey;
  throttle?: ThrottleConfig;
}

/**
 * Throttle configuration to avoid rate limiting.
 */
export interface ThrottleConfig {
  maxReqs: number;
  intervalSec: number;
  batchSize: number;
}

/**
 * Retry configuration for handling transient errors.
 */
export interface RetryConfig {
  maxAttempts: number;
  backoffSec: number;
  disableJobAfter: number;
}

/**
 * Conflict resolution policy.
 */
export type ConflictPolicy = "last_writer_wins" | "manual";

/**
 * Full configuration for a bidirectional sync job.
 */
export interface JobConfig {
  jobId: string;
  sideA: SideConfig;
  sideB: SideConfig;
  mapperAtoB: Mapper;
  mapperBtoA: Mapper;
  linkIndex: LinkIndex;
  retries?: RetryConfig;
  conflictPolicy?: ConflictPolicy;
}

/**
 * Default retry configuration.
 */
const DEFAULT_RETRIES: RetryConfig = {
  maxAttempts: 5,
  backoffSec: 30,
  disableJobAfter: 20,
};

/**
 * Default throttle configuration.
 */
const DEFAULT_THROTTLE: ThrottleConfig = {
  maxReqs: 50,
  intervalSec: 60,
  batchSize: 10,
};

/**
 * Throttler for rate limiting API calls per side.
 */
class Throttler {
  private requests: Date[] = [];
  private maxReqs: number;
  private intervalSec: number;

  constructor(maxReqs: number, intervalSec: number) {
    this.maxReqs = maxReqs;
    this.intervalSec = intervalSec;
  }

  /**
   * Wait if necessary to respect rate limits.
   */
  async throttle(): Promise<void> {
    const now = new Date();
    const cutoff = new Date(now.getTime() - this.intervalSec * 1000);

    // Remove old requests outside the window
    this.requests = this.requests.filter((req) => req > cutoff);

    if (this.requests.length >= this.maxReqs) {
      // Need to wait until the oldest request expires
      const oldest = this.requests[0];
      const waitUntil = new Date(oldest.getTime() + this.intervalSec * 1000);
      const waitMs = waitUntil.getTime() - now.getTime();
      if (waitMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        // Recalculate after waiting
        return this.throttle();
      }
    }

    this.requests.push(new Date());
  }
}

/**
 * SyncEngine orchestrates bidirectional synchronization between two data sources.
 */
export class SyncEngine {
  private config: JobConfig;
  private throttlerA: Throttler;
  private throttlerB: Throttler;

  constructor(config: JobConfig) {
    this.config = {
      ...config,
      retries: { ...DEFAULT_RETRIES, ...config.retries },
      conflictPolicy: config.conflictPolicy || "last_writer_wins",
    };
    // Apply default throttle if not specified
    if (!this.config.sideA.throttle) {
      this.config.sideA.throttle = { ...DEFAULT_THROTTLE };
    }
    if (!this.config.sideB.throttle) {
      this.config.sideB.throttle = { ...DEFAULT_THROTTLE };
    }

    // Initialize throttlers
    this.throttlerA = new Throttler(
      this.config.sideA.throttle.maxReqs,
      this.config.sideA.throttle.intervalSec
    );
    this.throttlerB = new Throttler(
      this.config.sideB.throttle.maxReqs,
      this.config.sideB.throttle.intervalSec
    );
  }

  /**
   * Execute one sync cycle for the configured job.
   * Implements the flow described in Section 5 of the masterplan:
   * 1. Skip if disabled
   * 2. Pull phase (getUpdates from both sides)
   * 3. Transform & Dedup
   * 4. Push phase (batched, with throttle and retry)
   * 5. Persist cursors and links
   * 6. Error handling
   */
  async run(): Promise<RunSummary> {
    const runId = this.generateRunId();
    const startedAt = new Date();
    const { jobId, linkIndex, sideA, sideB, mapperAtoB, mapperBtoA, retries } =
      this.config;

    this.log(`[${runId}] Starting sync job: ${jobId}`);

    const stats = {
      upsertsAtoB: 0,
      deletesAtoB: 0,
      upsertsBtoA: 0,
      deletesBtoA: 0,
      conflicts: 0,
      errors: [] as string[],
      retries: 0,
    };

    try {
      // Step 1: Check if job is disabled
      const isDisabled = await linkIndex.isJobDisabled(jobId);
      if (isDisabled) {
        this.log(`[${runId}] Job ${jobId} is disabled, skipping`);
        return this.createRunSummary(runId, jobId, startedAt, "failed", {
          reason: "job_disabled",
        });
      }

      // Step 2: Pull phase - get updates from both sides
      const cursorA = await linkIndex.loadCursor(jobId, sideA.sideKey);
      const cursorB = await linkIndex.loadCursor(jobId, sideB.sideKey);

      let resultA: { changes: ChangeSet; nextCursor: Cursor };
      let resultB: { changes: ChangeSet; nextCursor: Cursor };

      try {
        resultA = await sideA.adapter.getUpdates(cursorA);
      } catch (error) {
        const msg = `Failed to get updates from side A: ${error}`;
        stats.errors.push(msg);
        throw new Error(msg);
      }

      try {
        resultB = await sideB.adapter.getUpdates(cursorB);
      } catch (error) {
        const msg = `Failed to get updates from side B: ${error}`;
        stats.errors.push(msg);
        throw new Error(msg);
      }

      const changesA = resultA.changes;
      const changesB = resultB.changes;
      const nextCursorA = resultA.nextCursor;
      const nextCursorB = resultB.nextCursor;

      // Step 3: Transform & Dedup - map records and use LinkIndex to prevent echoes
      // Track records we push in this cycle to prevent immediate echo
      const pushedThisCycle = new Set<string>();

      // Process A → B
      const resultAtoB = await this.transformAndDedup(
        changesA,
        sideA.sideKey,
        sideB.sideKey,
        mapperAtoB,
        linkIndex,
        pushedThisCycle,
        stats
      );
      const changesAtoB = resultAtoB.changes;
      const linkMapAtoB = resultAtoB.linkMap;

      // Process B → A
      const resultBtoA = await this.transformAndDedup(
        changesB,
        sideB.sideKey,
        sideA.sideKey,
        mapperBtoA,
        linkIndex,
        pushedThisCycle,
        stats
      );
      const changesBtoA = resultBtoA.changes;
      const linkMapBtoA = resultBtoA.linkMap;

      // Step 4: Push phase - apply changes with batching, throttling, and retry
      if (changesAtoB.upserts.length > 0 || changesAtoB.deletes.length > 0) {
        await this.pushChanges(
          sideB.adapter,
          changesAtoB,
          sideB.throttle!,
          this.throttlerB,
          retries!,
          stats
        );
        stats.upsertsAtoB = changesAtoB.upserts.length;
        stats.deletesAtoB = changesAtoB.deletes.length;

        // Update links for successfully pushed records
        for (const [sourceId, destId] of linkMapAtoB) {
          await linkIndex.upsertLink(sourceId, destId);
        }
      }

      if (changesBtoA.upserts.length > 0 || changesBtoA.deletes.length > 0) {
        await this.pushChanges(
          sideA.adapter,
          changesBtoA,
          sideA.throttle!,
          this.throttlerA,
          retries!,
          stats
        );
        stats.upsertsBtoA = changesBtoA.upserts.length;
        stats.deletesBtoA = changesBtoA.deletes.length;

        // Update links for successfully pushed records
        for (const [sourceId, destId] of linkMapBtoA) {
          await linkIndex.upsertLink(sourceId, destId);
        }
      }

      // Step 5: Persist - save cursors and link upserts
      await linkIndex.saveCursor(jobId, sideA.sideKey, nextCursorA);
      await linkIndex.saveCursor(jobId, sideB.sideKey, nextCursorB);

      const endedAt = new Date();
      const status =
        stats.errors.length > 0
          ? stats.upsertsAtoB + stats.upsertsBtoA > 0
            ? "partial"
            : "failed"
          : "success";

      const summary = this.createRunSummary(runId, jobId, startedAt, status, {
        ...stats,
        durationMs: endedAt.getTime() - startedAt.getTime(),
      });

      await linkIndex.insertRun(summary);

      this.log(`[${runId}] Sync job ${jobId} completed: ${status}`);
      return summary;
    } catch (error) {
      // Step 6: Error handling
      const errorMsg =
        error instanceof Error ? error.message : String(error);
      stats.errors.push(errorMsg);

      const endedAt = new Date();
      const summary = this.createRunSummary(
        runId,
        jobId,
        startedAt,
        "failed",
        {
          ...stats,
          durationMs: endedAt.getTime() - startedAt.getTime(),
          fatalError: errorMsg,
        }
      );

      // Check if we should disable the job
      // Note: Since LinkIndex doesn't expose fail_count per cursor,
      // we'll track failures at the run level. For now, we disable
      // after consecutive failures in future runs.
      await linkIndex.insertRun(summary);

      this.log(`[${runId}] Sync job ${jobId} failed: ${errorMsg}`);
      return summary;
    }
  }

  /**
   * Transform and deduplicate changes, preventing echoes and handling conflicts.
   * Returns the transformed changes and a mapping of source IDs to destination IDs.
   */
  private async transformAndDedup(
    sourceChanges: ChangeSet,
    sourceSide: SideKey,
    destSide: SideKey,
    mapper: Mapper,
    linkIndex: LinkIndex,
    pushedThisCycle: Set<string>,
    stats: { conflicts: number; errors: string[] }
  ): Promise<{ changes: ChangeSet; linkMap: Map<string, string> }> {
    const upserts: SyncRecord[] = [];
    const deletes: RecordID[] = [];
    const linkMap = new Map<string, string>(); // sourceId -> destId

    // Process upserts
    for (const sourceRec of sourceChanges.upserts) {
      // Skip if we just pushed this record in this cycle (echo prevention within same run)
      if (pushedThisCycle.has(sourceRec.id)) {
        continue;
      }

      // Transform the record to get the destination ID
      let destRec: SyncRecord;
      try {
        destRec = mapper.toDest(sourceRec);
      } catch (error) {
        const msg = `Failed to map record ${sourceRec.id}: ${error}`;
        stats.errors.push(msg);
        this.log(`Warning: ${msg}`);
        continue;
      }

      // Check if this destination record already exists and came from the source side
      // This prevents echoes across runs: if destRec.id already has a link pointing back
      // to sourceRec.id, we're trying to sync it back - skip it
      const existingSourceId = await linkIndex.findSource(destRec.id);
      if (existingSourceId === sourceRec.id) {
        // This record already exists in the destination and came from the source
        // We're trying to sync it back - this is an echo, skip it
        continue;
      }

      // Check if this source record already has a link to a different destination
      const existingDestId = await linkIndex.findDest(sourceRec.id);

      if (existingDestId) {
        // Record exists on both sides - check for conflicts
        const conflictHandled = await this.handleConflict(
          sourceRec,
          existingDestId,
          sourceSide,
          destSide,
          stats
        );
        if (conflictHandled) {
          continue; // Conflict was handled, skip this change
        }
        // Use existing link
        linkMap.set(sourceRec.id, existingDestId);
      } else {
        // New record - use the transformed destination ID
        linkMap.set(sourceRec.id, destRec.id);
      }

      // Add to upserts
      upserts.push(destRec);

      // Track that we'll push this source record
      pushedThisCycle.add(sourceRec.id);
    }

    // Process deletes
    for (const sourceId of sourceChanges.deletes) {
      // Skip if we just pushed this record in this cycle
      if (pushedThisCycle.has(sourceId)) {
        continue;
      }

      const existingDestId = await linkIndex.findDest(sourceId);
      if (existingDestId) {
        deletes.push(existingDestId);
        // Track that we processed this source record
        pushedThisCycle.add(sourceId);
      }
    }

    return { changes: { upserts, deletes }, linkMap };
  }

  /**
   * Handle conflict detection and resolution based on conflict policy.
   * Returns true if the conflict was handled (change should be skipped).
   */
  private async handleConflict(
    sourceRec: SyncRecord,
    destId: string,
    sourceSide: SideKey,
    destSide: SideKey,
    stats: { conflicts: number }
  ): Promise<boolean> {
    const { conflictPolicy } = this.config;

    if (conflictPolicy === "manual") {
      // For manual conflict resolution, we'd record in conflicts table
      // but LinkIndex doesn't have that method yet, so we log and skip
      stats.conflicts++;
      this.log(
        `Conflict detected for record ${sourceRec.id} (${sourceSide} → ${destSide}). Manual resolution required.`
      );
      return true; // Skip this change
    }

    // last_writer_wins: compare timestamps
    // Try common timestamp field names
    const sourceTime = this.extractTimestamp(sourceRec);
    if (sourceTime === null) {
      // No timestamp available, assume source is newer and proceed
      return false;
    }

    // For last_writer_wins, we need the destination record's timestamp
    // But we don't have it here - we'd need to fetch it. For now,
    // we'll assume source is newer and proceed. In a real implementation,
    // adapters might provide this via the LinkIndex or we'd fetch it.
    // This is a limitation we'll work around by proceeding.
    return false;
  }

  /**
   * Extract timestamp from a record, trying common field names.
   */
  private extractTimestamp(rec: SyncRecord): number | null {
    const timestampFields = [
      "updatedAt",
      "updated_at",
      "updatedOn",
      "updated_on",
      "lastModified",
      "last_modified",
      "modifiedAt",
      "modified_at",
    ];

    for (const field of timestampFields) {
      if (rec[field]) {
        const value = rec[field];
        if (typeof value === "number") {
          return value;
        }
        if (typeof value === "string") {
          const parsed = Date.parse(value);
          if (!isNaN(parsed)) {
            return parsed;
          }
        }
        if (value instanceof Date) {
          return value.getTime();
        }
      }
    }

    return null;
  }

  /**
   * Push changes to a destination adapter with batching, throttling, and retry logic.
   */
  private async pushChanges(
    adapter: SourceAdapter,
    changes: ChangeSet,
    throttleConfig: ThrottleConfig,
    throttler: Throttler,
    retryConfig: RetryConfig,
    stats: { retries: number; errors: string[] }
  ): Promise<void> {
    const batchSize = throttleConfig.batchSize;

    // Batch upserts
    for (let i = 0; i < changes.upserts.length; i += batchSize) {
      const batch = changes.upserts.slice(i, i + batchSize);
      const batchChangeSet: ChangeSet = {
        upserts: batch,
        deletes: [],
      };

      await this.applyWithRetry(
        adapter,
        batchChangeSet,
        throttler,
        retryConfig,
        stats
      );
    }

    // Batch deletes
    for (let i = 0; i < changes.deletes.length; i += batchSize) {
      const batch = changes.deletes.slice(i, i + batchSize);
      const batchChangeSet: ChangeSet = {
        upserts: [],
        deletes: batch,
      };

      await this.applyWithRetry(
        adapter,
        batchChangeSet,
        throttler,
        retryConfig,
        stats
      );
    }
  }

  /**
   * Apply changes with retry logic and exponential backoff.
   */
  private async applyWithRetry(
    adapter: SourceAdapter,
    changes: ChangeSet,
    throttler: Throttler,
    retryConfig: RetryConfig,
    stats: { retries: number; errors: string[] }
  ): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= retryConfig.maxAttempts; attempt++) {
      try {
        await throttler.throttle();
        await adapter.applyChanges(changes);
        return; // Success
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < retryConfig.maxAttempts) {
          stats.retries++;
          const backoffMs =
            retryConfig.backoffSec * 1000 * Math.pow(2, attempt - 1);
          this.log(
            `Retry attempt ${attempt}/${retryConfig.maxAttempts} after ${backoffMs}ms: ${lastError.message}`
          );
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        }
      }
    }

    // All retries exhausted
    const msg = `Failed after ${retryConfig.maxAttempts} attempts: ${lastError?.message}`;
    stats.errors.push(msg);
    throw new Error(msg);
  }

  /**
   * Simple logging helper (will be replaced with structured JSON logger).
   */
  private log(message: string): void {
    // TODO: Replace with structured JSON logger per Section 7 of masterplan
    if (typeof process !== "undefined" && process.stdout) {
      process.stdout.write(`${message}\n`);
    }
  }

  /**
   * Generate a unique run ID.
   */
  private generateRunId(): string {
    return `run_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Create a RunSummary object.
   */
  private createRunSummary(
    runId: string,
    jobId: string,
    startedAt: Date,
    status: "success" | "partial" | "failed",
    summaryJson: any
  ): RunSummary {
    return {
      runId,
      jobId,
      startedAt,
      endedAt: new Date(),
      status,
      summaryJson,
    };
  }
}

