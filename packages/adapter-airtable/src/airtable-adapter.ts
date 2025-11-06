/**
 * AirtableAdapter - An Airtable implementation of SourceAdapter.
 * Connects to Airtable bases and tables using the Airtable API.
 */

import Airtable from "airtable";
import type {
  SourceAdapter,
  Cursor,
  ChangeSet,
  Record,
  RecordID,
} from "@syncframe/core";

/**
 * Configuration options for AirtableAdapter.
 */
export interface AirtableAdapterOptions {
  /**
   * Airtable API key.
   */
  apiKey: string;
  /**
   * Airtable base ID (e.g., "app123").
   */
  baseId: string;
  /**
   * Table name within the base.
   */
  table: string;
  /**
   * Optional field name to check for soft deletes.
   * If specified, records with this field set to a truthy value will be
   * included in the deletes array instead of upserts.
   * Common field names: "isDeleted", "Deleted", "Status" (if Status="Deleted"), etc.
   */
  softDeleteField?: string;
}

/**
 * Cursor structure for Airtable pagination.
 * Stores the offset token and optionally a lastModifiedTime for incremental sync.
 */
interface AirtableCursor {
  offset?: string;
  lastModifiedTime?: string;
}

/**
 * Airtable adapter that implements SourceAdapter for syncing with Airtable bases.
 */
export class AirtableAdapter implements SourceAdapter {
  private base: Airtable.Base;
  private table: string;
  private softDeleteField?: string;

  constructor(options: AirtableAdapterOptions) {
    // Validate required options
    if (!options.apiKey) {
      throw new Error("AirtableAdapter requires apiKey");
    }
    if (!options.baseId) {
      throw new Error("AirtableAdapter requires baseId");
    }
    if (!options.table) {
      throw new Error("AirtableAdapter requires table");
    }

    // Initialize Airtable client
    Airtable.configure({
      apiKey: options.apiKey,
    });
    this.base = Airtable.base(options.baseId);
    this.table = options.table;
    this.softDeleteField = options.softDeleteField;
  }

  /**
   * Get updates since the given cursor.
   * Uses Airtable's lastModifiedTime for incremental sync.
   * Note: Airtable offset tokens are ephemeral, so we use lastModifiedTime as the cursor.
   */
  async getUpdates(
    cursor: Cursor
  ): Promise<{ changes: ChangeSet; nextCursor: Cursor }> {
    const atTable = this.base(this.table);
    let lastModifiedTime: string | undefined;

    // Parse cursor if present
    if (cursor.value) {
      try {
        const parsedCursor = JSON.parse(cursor.value) as AirtableCursor;
        lastModifiedTime = parsedCursor.lastModifiedTime;
      } catch {
        // Invalid cursor format, treat as initial sync
      }
    }

    // Build query options
    const queryOptions: any = {
      pageSize: 100, // Airtable's max page size
    };

    // If we have a lastModifiedTime, filter for records modified after that time
    if (lastModifiedTime) {
      // Format: ISO 8601 timestamp
      queryOptions.filterByFormula = `IS_AFTER({Last Modified Time}, "${lastModifiedTime}")`;
    }

    // Fetch all records page by page
    // Separate records into upserts and deletes based on soft delete field
    const upserts: Record[] = [];
    const deletes: RecordID[] = [];
    let maxLastModified: string | undefined = lastModifiedTime;

    await new Promise<void>((resolve, reject) => {
      atTable
        .select({
          ...queryOptions,
          sort: [{ field: "Last Modified Time", direction: "asc" }],
        })
        .eachPage(
          (records, fetchNextPage) => {
            for (const record of records) {
              // Convert Airtable record to SyncFrame Record format
              const syncRecord: Record = {
                id: record.id,
                ...record.fields,
                // Include Airtable metadata for reference
                _airtableLastModifiedTime: record._rawJson.lastModifiedTime,
              };

              // Check for soft delete if configured
              if (this.softDeleteField && this.isSoftDeleted(syncRecord)) {
                // Include in deletes array
                deletes.push(record.id);
              } else {
                // Include in upserts array
                upserts.push(syncRecord);
              }

              // Track the newest modified time we've seen
              const recordTime = record._rawJson.lastModifiedTime;
              if (
                recordTime &&
                (!maxLastModified || recordTime > maxLastModified)
              ) {
                maxLastModified = recordTime;
              }
            }

            fetchNextPage();
          },
          (err) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          }
        );
    });

    // Use lastModifiedTime as cursor (offset tokens are ephemeral in Airtable)
    // If no records were found, keep the previous cursor time or use current time
    const nextLastModified =
      maxLastModified || lastModifiedTime || new Date().toISOString();

    const nextCursor: Cursor = {
      value: JSON.stringify({
        lastModifiedTime: nextLastModified,
      } as AirtableCursor),
    };

    return {
      changes: {
        upserts,
        deletes,
      },
      nextCursor,
    };
  }

  /**
   * Check if a record is soft-deleted based on the configured softDeleteField.
   * @param record - The record to check
   * @returns true if the record is soft-deleted
   */
  private isSoftDeleted(record: Record): boolean {
    if (!this.softDeleteField) {
      return false;
    }

    const value = record[this.softDeleteField];
    
    // Handle various truthy values that might indicate deletion
    if (value === true || value === "true" || value === "True" || value === "TRUE") {
      return true;
    }
    
    // Handle string values like "Deleted", "deleted", etc.
    if (typeof value === "string") {
      const lowerValue = value.toLowerCase().trim();
      if (lowerValue === "deleted" || lowerValue === "delete") {
        return true;
      }
    }
    
    // Handle numeric values (1 = deleted, 0 = not deleted)
    if (typeof value === "number" && value !== 0) {
      return true;
    }
    
    return false;
  }

  /**
   * Apply changes to Airtable.
   * Creates new records, updates existing ones, and deletes records.
   * Airtable batch operations are limited to 10 records per request.
   */
  async applyChanges(changes: ChangeSet): Promise<void> {
    const atTable = this.base(this.table);
    const batchSize = 10;

    // Process upserts
    if (changes.upserts.length > 0) {
      for (let i = 0; i < changes.upserts.length; i += batchSize) {
        const batch = changes.upserts.slice(i, i + batchSize);

        const recordsToCreate: Array<{ fields: any }> = [];
        const recordsToUpdate: Array<{ id: string; fields: any }> = [];

        for (const record of batch) {
          // Remove SyncFrame-specific metadata fields
          const {
            id,
            _airtableLastModifiedTime,
            ...fields
          } = record;

          // Airtable record IDs start with "rec"
          if (id && id.startsWith("rec")) {
            // Existing record - update
            recordsToUpdate.push({ id, fields });
          } else {
            // New record - create
            recordsToCreate.push({ fields });
          }
        }

        // Create new records in batch
        if (recordsToCreate.length > 0) {
          await atTable.create(recordsToCreate);
        }

        // Update existing records (Airtable update() method updates one at a time)
        // We could batch updates, but the API doesn't support it directly
        for (const record of recordsToUpdate) {
          await atTable.update(record.id, record.fields);
        }
      }
    }

    // Process deletes
    if (changes.deletes.length > 0) {
      for (let i = 0; i < changes.deletes.length; i += batchSize) {
        const batch = changes.deletes.slice(i, i + batchSize);
        // Airtable destroy() supports batch deletion
        await atTable.destroy(batch);
      }
    }
  }

  /**
   * Serialize a cursor to a string.
   */
  serializeCursor(cursor: Cursor): string {
    return cursor.value ?? "";
  }
}

