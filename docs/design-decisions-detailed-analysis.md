# Design Decisions - Detailed Analysis

## Question 1: Option B (Extend LinkIndex Interface) - Detailed Analysis

### How is it more flexible?

**Current State (Option A - Construction-time context):**
- One LinkIndex instance per job
- Each instance is "bound" to a specific job configuration
- Cannot query across multiple jobs
- Cannot share a single LinkIndex instance across jobs

**Option B (Extended Interface) would allow:**
1. **Multi-job instances**: One LinkIndex could serve multiple jobs
   ```typescript
   // Single instance for all jobs
   const linkIndex = new SqliteLinkIndex("./syncframe.db");
   
   // Job 1: Airtable ↔ Webflow
   linkIndex.upsertLink("airtable", "Videos", "rec123", "webflow", "videos", "vid456");
   
   // Job 2: Airtable ↔ HubSpot (same instance)
   linkIndex.upsertLink("airtable", "Contacts", "rec789", "hubspot", "contacts", "hs123");
   ```

2. **Cross-job queries**: Query all links for a specific adapter/table across all jobs
   ```typescript
   // Find all Webflow records linked from any Airtable table
   linkIndex.findLinksByDest("webflow", "videos");
   ```

3. **Better debugging**: See all relationships in one place regardless of job boundaries
4. **Schema alignment**: Database schema exactly matches the interface signature

### What changes are required?

#### 1. Update LinkIndex Interface (Core Package)

**Current:**
```typescript
interface LinkIndex {
  upsertLink(sourceId: string, destId: string): Promise<void>;
  findDest(sourceId: string): Promise<string | null>;
  findSource(destId: string): Promise<string | null>;
  loadCursor(jobId: string, side: SideKey): Promise<Cursor>;
  saveCursor(jobId: string, side: SideKey, cursor: Cursor): Promise<void>;
  // ...
}
```

**Option B:**
```typescript
interface LinkIndex {
  // Links now require adapter/table context
  upsertLink(
    sourceAdapter: string,
    sourceTable: string,
    sourceId: string,
    destAdapter: string,
    destTable: string,
    destId: string
  ): Promise<void>;
  
  findDest(
    sourceAdapter: string,
    sourceTable: string,
    sourceId: string
  ): Promise<string | null>;
  
  findSource(
    destAdapter: string,
    destTable: string,
    destId: string
  ): Promise<string | null>;
  
  // Cursors now require adapter/table
  loadCursor(
    jobId: string,
    adapter: string,
    table: string
  ): Promise<Cursor>;
  
  saveCursor(
    jobId: string,
    adapter: string,
    table: string,
    cursor: Cursor
  ): Promise<void>;
  
  // ...
}
```

#### 2. Update SyncEngine (Core Package)

**Current engine code:**
```typescript
// Line 264-266
for (const [sourceId, destId] of linkMapAtoB) {
  await linkIndex.upsertLink(sourceId, destId);
}

// Line 288-289
await linkIndex.saveCursor(jobId, sideA.sideKey, nextCursorA);
await linkIndex.saveCursor(jobId, sideB.sideKey, nextCursorB);
```

**Option B changes:**
```typescript
// Need to pass adapter/table info
const sideAAdapter = this.config.sideA.adapterName; // NEW: Need to add this
const sideATable = this.config.sideA.tableName;     // NEW: Need to add this
const sideBAdapter = this.config.sideB.adapterName; // NEW: Need to add this
const sideBTable = this.config.sideB.tableName;     // NEW: Need to add this

for (const [sourceId, destId] of linkMapAtoB) {
  await linkIndex.upsertLink(
    sideAAdapter, sideATable, sourceId,
    sideBAdapter, sideBTable, destId
  );
}

await linkIndex.saveCursor(jobId, sideAAdapter, sideATable, nextCursorA);
await linkIndex.saveCursor(jobId, sideBAdapter, sideBTable, nextCursorB);
```

#### 3. Update SideConfig (Core Package)

**Current:**
```typescript
export interface SideConfig {
  adapter: SourceAdapter;  // Instance
  sideKey: SideKey;
  throttle?: ThrottleConfig;
}
```

**Option B:**
```typescript
export interface SideConfig {
  adapter: SourceAdapter;
  adapterName: string;     // NEW: "airtable", "webflow", etc.
  tableName: string;       // NEW: "Videos", "videos", etc.
  sideKey: SideKey;
  throttle?: ThrottleConfig;
}
```

#### 4. Update Transform Logic (Core Package)

**Current:**
```typescript
// Line 376: findSource uses just destId
const existingSourceId = await linkIndex.findSource(destRec.id);
```

**Option B:**
```typescript
// Need adapter/table context
const existingSourceId = await linkIndex.findSource(
  destAdapter, destTable, destRec.id
);
```

#### 5. Update InMemoryLinkIndex (LinkIndex Package)

**Current:**
```typescript
async upsertLink(sourceId: string, destId: string): Promise<void> {
  this.sourceToDest.set(sourceId, destId);
  this.destToSource.set(destId, sourceId);
}
```

**Option B:**
```typescript
async upsertLink(
  sourceAdapter: string, sourceTable: string, sourceId: string,
  destAdapter: string, destTable: string, destId: string
): Promise<void> {
  // Need composite keys
  const sourceKey = `${sourceAdapter}:${sourceTable}:${sourceId}`;
  const destKey = `${destAdapter}:${destTable}:${destId}`;
  this.sourceToDest.set(sourceKey, destKey);
  this.destToSource.set(destKey, sourceKey);
}
```

#### 6. Update CLI (CLI Package)

**Current (if CLI exists):**
```typescript
const sideA: SideConfig = {
  adapter: adapterA,
  sideKey: sideAName,
};
```

**Option B:**
```typescript
const sideA: SideConfig = {
  adapter: adapterA,
  adapterName: sideAConfig.adapter,  // NEW: "airtable"
  tableName: sideAConfig.table,      // NEW: "Videos"
  sideKey: sideAName,
};
```

#### 7. Update All Tests

Every test that creates a `LinkIndex` or calls its methods needs updating:
- `packages/core/__tests__/engine.test.ts` - All test cases
- Any other tests that use LinkIndex

### Impact on Other Parts of the Plan

**Breaking Changes:**
- ✅ **Breaking change** for all existing code using LinkIndex
- ✅ **Breaking change** for InMemoryLinkIndex (used in tests)
- ✅ **Breaking change** for any future adapters written before this change

**Migration Path:**
- Need to update core package first
- Then update linkindex packages
- Then update CLI (if it exists)
- Then update all tests
- Could be done in phases if we version carefully

**Benefits:**
- ✅ Schema matches interface exactly
- ✅ Supports multi-job instances (more efficient)
- ✅ Better for debugging and cross-job queries
- ✅ More flexible for future features

**Drawbacks:**
- ❌ Large refactoring effort
- ❌ Breaking change for existing code
- ❌ More verbose API calls
- ❌ Engine needs adapter/table names (not just instances)

---

## Question 2: Why is Conflicts Table Unused Until Engine Changes?

### Current Engine Implementation

Looking at `packages/core/src/engine.ts` lines 443-450:

```typescript
if (conflictPolicy === "manual") {
  // For manual conflict resolution, we'd record in conflicts table
  // but LinkIndex doesn't have that method yet, so we log and skip
  stats.conflicts++;
  this.log(
    `Conflict detected for record ${sourceRec.id} (${sourceSide} → ${destSide}). Manual resolution required.`
  );
  return true; // Skip this change
}
```

### What's Missing

1. **No LinkIndex method to insert conflicts**
   - The interface doesn't have `insertConflict()` method
   - Engine can't persist conflicts even if it detects them

2. **Engine detects conflicts but can't persist them**
   - Conflict detection works (lines 387-397)
   - When policy is "manual", it just logs and skips
   - No persistence layer to store conflict details

### What Would Need to Change

**1. Add to LinkIndex Interface:**
```typescript
interface LinkIndex {
  // ... existing methods ...
  
  insertConflict(
    jobId: string,
    sourceAdapter: string,
    sourceTable: string,
    sourceId: string,
    destAdapter: string,
    destTable: string,
    destId: string,
    sourcePayload: Record,
    destPayload: Record,
    detectedAt: Date
  ): Promise<void>;
  
  getConflicts(jobId: string): Promise<Conflict[]>;
  resolveConflict(conflictId: string): Promise<void>;
}
```

**2. Update Engine to Use It:**
```typescript
if (conflictPolicy === "manual") {
  // Get destination record for conflict details
  const destRecord = await fetchDestRecord(destId); // NEW: Need to fetch
  
  await linkIndex.insertConflict(
    jobId,
    sourceAdapter, sourceTable, sourceRec.id,
    destAdapter, destTable, destId,
    sourceRec,
    destRecord,
    new Date()
  );
  
  stats.conflicts++;
  return true;
}
```

**3. Engine would need adapter/table names:**
- Same issue as Question 1 - need adapter/table context in engine

### Why Not Implemented Yet?

- **Dependency**: Requires adapter/table context (Question 1 decision)
- **Not critical path**: Last-writer-wins policy works without it
- **Future feature**: Manual conflict resolution is a nice-to-have for v0.1
- **Schema ready**: Table exists in masterplan, just waiting for interface

---

## Question 3: Why Isn't Fail Count Used Now?

### Masterplan Intent

From `masterplan.md` lines 152-153:
```
- after `max_attempts`, increment `fail_count`.
- if `fail_count` ≥ `disable_job_after`, set `disabled_at` timestamp.
```

### Current Implementation

Looking at `packages/core/src/engine.ts` lines 327-331:

```typescript
// Check if we should disable the job
// Note: Since LinkIndex doesn't expose fail_count per cursor,
// we'll track failures at the run level. For now, we disable
// after consecutive failures in future runs.
await linkIndex.insertRun(summary);
```

### What's Missing

1. **No per-cursor fail_count tracking**
   - Schema has `fail_count` in `cursors` table
   - But LinkIndex interface doesn't expose methods to:
     - Increment fail_count
     - Read fail_count
     - Reset fail_count on success

2. **Engine doesn't track per-side failures**
   - Failures could be on sideA or sideB
   - Each side has its own cursor
   - Should track failures per cursor (per side)

3. **No logic to disable job based on fail_count**
   - Engine checks `isJobDisabled()` but never sets it based on fail_count
   - The `disableJobAfter` config exists but isn't used

### What Would Need to Change

**1. Add to LinkIndex Interface:**
```typescript
interface LinkIndex {
  // ... existing methods ...
  
  incrementFailCount(
    jobId: string,
    adapter: string,
    table: string
  ): Promise<number>; // Returns new fail_count
  
  resetFailCount(
    jobId: string,
    adapter: string,
    table: string
  ): Promise<void>;
  
  getFailCount(
    jobId: string,
    adapter: string,
    table: string
  ): Promise<number>;
}
```

**2. Update Engine Logic:**

**On failure:**
```typescript
catch (error) {
  // ... existing error handling ...
  
  // Increment fail_count for the side that failed
  // Need to know which side failed (could be A, B, or both)
  const failedSide = determineFailedSide(error); // NEW logic needed
  
  if (failedSide === 'A') {
    const newFailCount = await linkIndex.incrementFailCount(
      jobId, sideAAdapter, sideATable
    );
    
    if (newFailCount >= retries.disableJobAfter) {
      await linkIndex.setJobDisabled(jobId, new Date());
    }
  }
  // ... similar for side B ...
}
```

**On success:**
```typescript
// After successful run, reset fail_count for both sides
await linkIndex.resetFailCount(jobId, sideAAdapter, sideATable);
await linkIndex.resetFailCount(jobId, sideBAdapter, sideBTable);
```

**3. Need adapter/table context:**
- Same dependency as Question 1 - need adapter/table names in engine

### Why Not Implemented Yet?

1. **Dependency on adapter/table context**: Can't track per-cursor without knowing which adapter/table
2. **Complexity in determining failure side**: Need to know if failure was on sideA, sideB, or both
3. **Not blocking**: Jobs can be manually disabled, and run-level tracking exists
4. **Future enhancement**: Works for v0.1, can add in v0.2

### Current Workaround

The engine currently:
- Tracks failures at the **run level** (in `RunSummary`)
- Can manually disable jobs via `setJobDisabled()`
- But doesn't auto-disable based on fail_count

---

## Summary

### Question 1: Option B Flexibility
- **More flexible**: Multi-job instances, cross-job queries, better debugging
- **Changes required**: Interface, Engine, SideConfig, InMemoryLinkIndex, CLI, all tests
- **Impact**: Breaking change, large refactoring, but better long-term design

### Question 2: Conflicts Table
- **Unused because**: No interface methods exist, engine can't persist conflicts
- **Needs**: Interface methods, adapter/table context, engine updates
- **Status**: Schema ready, implementation deferred

### Question 3: Fail Count
- **Not used because**: No interface methods, no per-cursor tracking, complex failure attribution
- **Needs**: Interface methods, adapter/table context, failure-side detection logic
- **Status**: Config exists, logic not implemented yet

### Common Dependency

All three features depend on **adapter/table context** being available in the engine, which ties back to Question 1's decision between Option A and Option B.

