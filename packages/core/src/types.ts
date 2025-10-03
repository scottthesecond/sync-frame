/**
 * Core type definitions and contracts for SyncFrame.
 * These interfaces define the protocol that adapters and link indexes must implement.
 */

/**
 * Represents a cursor position for pagination/incremental sync.
 * The value is opaque to the engine; adapters decide the format.
 */
export interface Cursor {
  value: string | null;
}

/**
 * A generic record from any data source.
 * Adapters can use any shape; the Mapper is responsible for transformation.
 */
export type Record = {
  id: string;
  [key: string]: any;
};

/**
 * Identifier for a record in any system.
 */
export type RecordID = string;

/**
 * A set of changes detected from a data source.
 */
export interface ChangeSet {
  /** Records to create or update */
  upserts: Record[];
  /** IDs of records to delete (or soft-delete) */
  deletes: RecordID[];
}

/**
 * Adapter interface for connecting to a data source (Airtable, Webflow, etc).
 * Each side of a sync job has one adapter instance.
 */
export interface SourceAdapter {
  /**
   * Fetch changes since the given cursor.
   * @param cursor - The last known position (null for initial sync)
   * @returns A ChangeSet and a new cursor value
   */
  getUpdates(cursor: Cursor): Promise<{ changes: ChangeSet; nextCursor: Cursor }>;

  /**
   * Apply a set of changes to the remote system.
   * @param changes - The ChangeSet to apply
   */
  applyChanges(changes: ChangeSet): Promise<void>;

  /**
   * Serialize a cursor for storage.
   * @param cursor - The cursor to serialize
   * @returns A string representation of the cursor
   */
  serializeCursor(cursor: Cursor): string;
}

/**
 * Maps records between two different data sources.
 * Each direction (A→B and B→A) requires its own mapper.
 */
export interface Mapper {
  /**
   * Transform a source record to destination format.
   */
  toDest(srcRec: Record): Record;

  /**
   * Transform a destination record back to source format.
   */
  toSource(destRec: Record): Record;
}

/**
 * Which side of a job (typically "source" or "dest", but configurable).
 */
export type SideKey = string;

/**
 * Summary of a sync run.
 */
export interface RunSummary {
  runId: string;
  jobId: string;
  startedAt: Date;
  endedAt: Date | null;
  status: "success" | "partial" | "failed";
  summaryJson: any;
}

/**
 * LinkIndex interface for persisting bidirectional record links and job state.
 * Implementations can use SQLite, Postgres, or any other persistence layer.
 */
export interface LinkIndex {
  // --- Links ---
  /**
   * Store or update a link between a source record and destination record.
   */
  upsertLink(sourceId: string, destId: string): Promise<void>;

  /**
   * Find the destination ID for a given source ID.
   */
  findDest(sourceId: string): Promise<string | null>;

  /**
   * Find the source ID for a given destination ID.
   */
  findSource(destId: string): Promise<string | null>;

  // --- Cursors ---
  /**
   * Load the last known cursor for a job and side.
   */
  loadCursor(jobId: string, side: SideKey): Promise<Cursor>;

  /**
   * Save a cursor for a job and side.
   */
  saveCursor(jobId: string, side: SideKey, cursor: Cursor): Promise<void>;

  // --- Job State ---
  /**
   * Mark a job as disabled at the given timestamp.
   */
  setJobDisabled(jobId: string, ts: Date): Promise<void>;

  /**
   * Check if a job is currently disabled.
   */
  isJobDisabled(jobId: string): Promise<boolean>;

  // --- Run Logs ---
  /**
   * Insert a summary record for a sync run.
   */
  insertRun(run: RunSummary): Promise<void>;
}


