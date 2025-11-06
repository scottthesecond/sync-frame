# LinkIndex Test Implementation Plan

## Test List

### Phase 1: Fix Existing Engine Tests
1. ✅ Update `createTestEngine` to include `adapterName` and `tableName` in SideConfig
2. ✅ Update all engine tests to use new LinkIndex interface
3. ✅ Run engine tests and fix any failures

### Phase 2: Contract Tests (LinkIndex Interface)
4. ✅ Test: Basic link operations (upsertLink, findDest, findSource)
5. ✅ Test: Link updates (upsertLink with existing link)
6. ✅ Test: Cursor operations (saveCursor, loadCursor)
7. ✅ Test: Cursor persistence (null cursor for non-existent)
8. ✅ Test: Fail count tracking (increment, reset, get)
9. ✅ Test: Fail count per cursor independence
10. ✅ Test: Conflict operations (insert, get, resolve)
11. ✅ Test: Job state (setJobDisabled, isJobDisabled)
12. ✅ Test: Run logs (insertRun)

### Phase 3: Integration Tests with SyncEngine
13. ✅ Test: Basic sync flow with new interface
14. ✅ Test: Cursor persistence across runs
15. ✅ Test: Fail count tracking and job disabling
16. ✅ Test: Conflict detection and persistence

---

## Implementation Order

1. Fix existing engine tests first (they'll fail with new interface)
2. Create contract tests for LinkIndex
3. Run all tests and ensure they pass
4. Later: SQLite adapter tests (after SQLite adapter is built)

