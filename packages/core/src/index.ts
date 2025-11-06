/**
 * @syncframe/core - Core contracts and sync engine for SyncFrame
 *
 * This package provides:
 * - Type definitions and contracts (Cursor, ChangeSet, SourceAdapter, Mapper, LinkIndex)
 * - SyncEngine for orchestrating bidirectional sync
 * - Retry and throttle logic (to be implemented)
 *
 * Core never imports adapters; the CLI wires everything together at runtime.
 */

// Export all type definitions
export type {
  Cursor,
  Record,
  RecordID,
  ChangeSet,
  SourceAdapter,
  Mapper,
  SideKey,
  RunSummary,
  LinkIndex,
  Conflict,
} from "./types.js";

// Export engine and related types
export {
  SyncEngine,
  type SideConfig,
  type ThrottleConfig,
  type RetryConfig,
  type ConflictPolicy,
  type JobConfig,
} from "./engine.js";


