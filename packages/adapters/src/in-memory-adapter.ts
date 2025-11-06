/**
 * InMemoryAdapter - An in-memory implementation of SourceAdapter for testing.
 * Stores records in memory and simulates cursor-based pagination.
 */

import type {
  SourceAdapter,
  Cursor,
  ChangeSet,
  Record,
  RecordID,
} from "@syncframe/core";

/**
 * Configuration options for InMemoryAdapter.
 */
export interface InMemoryAdapterOptions {
  /**
   * Initial records to populate the adapter with.
   */
  initialRecords?: Record[];
}

/**
 * In-memory adapter that stores records and simulates cursor-based updates.
 * Useful for testing and development without external API dependencies.
 */
export class InMemoryAdapter implements SourceAdapter {
  private records: Map<string, Record>;
  private deletedIds: Set<string>;
  private cursorPosition: number;

  constructor(options: InMemoryAdapterOptions = {}) {
    this.records = new Map();
    this.deletedIds = new Set();
    this.cursorPosition = 0;

    // Initialize with provided records
    if (options.initialRecords) {
      for (const record of options.initialRecords) {
        this.records.set(record.id, { ...record });
      }
    }
  }

  /**
   * Get updates since the given cursor.
   * Returns all records that were created/updated after the cursor position.
   */
  async getUpdates(cursor: Cursor): Promise<{ changes: ChangeSet; nextCursor: Cursor }> {
    const startPosition = cursor.value ? parseInt(cursor.value, 10) : 0;
    const allRecords = Array.from(this.records.values());
    
    // Sort records by ID for consistent ordering (assuming IDs are sortable)
    // In a real adapter, you'd sort by a timestamp field
    const sortedRecords = allRecords.sort((a, b) => {
      // Try to sort by updatedAt if available, otherwise by ID
      const aTime = this.extractTimestamp(a);
      const bTime = this.extractTimestamp(b);
      if (aTime !== null && bTime !== null) {
        return aTime - bTime;
      }
      return a.id.localeCompare(b.id);
    });

    // Get records that are "new" since the cursor position
    // For simplicity, we'll return all records after the first `startPosition` records
    const newRecords = sortedRecords.slice(startPosition);
    
    // Get deleted IDs that haven't been processed yet
    // In a real implementation, we'd track when deletions happened
    const deletedRecords: RecordID[] = Array.from(this.deletedIds);
    
    // Clear deleted IDs after reporting them once
    this.deletedIds.clear();

    const nextCursor: Cursor = {
      value: String(sortedRecords.length),
    };

    return {
      changes: {
        upserts: newRecords,
        deletes: deletedRecords,
      },
      nextCursor,
    };
  }

  /**
   * Apply changes to the in-memory store.
   */
  async applyChanges(changes: ChangeSet): Promise<void> {
    // Apply upserts
    for (const record of changes.upserts) {
      this.records.set(record.id, { ...record });
    }

    // Apply deletes
    for (const id of changes.deletes) {
      this.records.delete(id);
    }
  }

  /**
   * Serialize a cursor to a string.
   */
  serializeCursor(cursor: Cursor): string {
    return cursor.value ?? "";
  }

  /**
   * Extract timestamp from a record, trying common field names.
   */
  private extractTimestamp(rec: Record): number | null {
    const timestampFields = [
      "updatedAt",
      "updated_at",
      "updatedOn",
      "updated_on",
      "lastModified",
      "last_modified",
      "modifiedAt",
      "modified_at",
      "createdAt",
      "created_at",
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
   * Get all current records (useful for testing/debugging).
   */
  getAllRecords(): Record[] {
    return Array.from(this.records.values());
  }

  /**
   * Get a specific record by ID (useful for testing/debugging).
   */
  getRecord(id: string): Record | undefined {
    return this.records.get(id);
  }

  /**
   * Manually add a record (useful for testing/debugging).
   */
  addRecord(record: Record): void {
    this.records.set(record.id, { ...record });
  }

  /**
   * Manually delete a record (useful for testing/debugging).
   */
  deleteRecord(id: string): void {
    this.records.delete(id);
    this.deletedIds.add(id);
  }

  /**
   * Clear all records (useful for testing/debugging).
   */
  clear(): void {
    this.records.clear();
    this.deletedIds.clear();
    this.cursorPosition = 0;
  }
}

