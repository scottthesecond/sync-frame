# LinkIndex Testing Strategy

## Overview

Testing LinkIndex adapters requires multiple levels of testing to ensure correctness, consistency, and integration with the sync engine.

## Testing Levels

### 1. **Contract Tests (Unit Level)**
**Purpose**: Ensure all LinkIndex implementations behave identically according to the interface contract.

**Approach**: Parametric/table-driven tests that work with any LinkIndex implementation.

**Location**: `packages/linkindex/__tests__/linkindex.contract.test.ts`

```typescript
/**
 * Contract tests for LinkIndex implementations.
 * These tests should pass for ALL LinkIndex implementations (InMemory, SQLite, Postgres, etc.)
 */
describe.each([
  ['InMemory', () => new InMemoryLinkIndex()],
  ['SQLite', () => new SqliteLinkIndex(':memory:')], // Use in-memory SQLite for tests
  // Future: ['Postgres', () => new PostgresLinkIndex('postgres://localhost/test')],
])('LinkIndex Contract Tests - %s', (name, createLinkIndex) => {
  let linkIndex: LinkIndex;

  beforeEach(async () => {
    linkIndex = createLinkIndex();
    // If SQLite, ensure tables are created
    if (linkIndex instanceof SqliteLinkIndex) {
      await linkIndex.initialize();
    }
  });

  afterEach(async () => {
    // Cleanup if needed
    if (linkIndex instanceof SqliteLinkIndex) {
      await linkIndex.close();
    }
  });

  describe('Links', () => {
    it('should upsert and retrieve links', async () => {
      await linkIndex.upsertLink(
        'airtable', 'Videos', 'rec123',
        'webflow', 'videos', 'vid456'
      );

      const destId = await linkIndex.findDest('airtable', 'Videos', 'rec123');
      expect(destId).toBe('vid456');

      const sourceId = await linkIndex.findSource('webflow', 'videos', 'vid456');
      expect(sourceId).toBe('rec123');
    });

    it('should update existing links', async () => {
      // Initial link
      await linkIndex.upsertLink('airtable', 'Videos', 'rec123', 'webflow', 'videos', 'vid456');
      
      // Update link
      await linkIndex.upsertLink('airtable', 'Videos', 'rec123', 'webflow', 'videos', 'vid789');
      
      const destId = await linkIndex.findDest('airtable', 'Videos', 'rec123');
      expect(destId).toBe('vid789');
    });

    it('should handle bidirectional lookups', async () => {
      await linkIndex.upsertLink(
        'airtable', 'Videos', 'rec123',
        'webflow', 'videos', 'vid456'
      );

      // Source → Dest
      expect(await linkIndex.findDest('airtable', 'Videos', 'rec123')).toBe('vid456');
      
      // Dest → Source
      expect(await linkIndex.findSource('webflow', 'videos', 'vid456')).toBe('rec123');
    });
  });

  describe('Cursors', () => {
    it('should save and load cursors', async () => {
      const cursor: Cursor = { value: 'cursor123' };
      await linkIndex.saveCursor('job1', 'airtable', 'Videos', cursor);

      const loaded = await linkIndex.loadCursor('job1', 'airtable', 'Videos');
      expect(loaded).toEqual(cursor);
    });

    it('should return null cursor for non-existent cursors', async () => {
      const cursor = await linkIndex.loadCursor('job1', 'airtable', 'Videos');
      expect(cursor).toEqual({ value: null });
    });
  });

  describe('Fail Count Tracking', () => {
    it('should increment fail count', async () => {
      const count1 = await linkIndex.incrementFailCount('job1', 'airtable', 'Videos');
      expect(count1).toBe(1);

      const count2 = await linkIndex.incrementFailCount('job1', 'airtable', 'Videos');
      expect(count2).toBe(2);
    });

    it('should reset fail count', async () => {
      await linkIndex.incrementFailCount('job1', 'airtable', 'Videos');
      await linkIndex.incrementFailCount('job1', 'airtable', 'Videos');
      
      await linkIndex.resetFailCount('job1', 'airtable', 'Videos');
      
      const count = await linkIndex.getFailCount('job1', 'airtable', 'Videos');
      expect(count).toBe(0);
    });

    it('should track fail counts per cursor independently', async () => {
      await linkIndex.incrementFailCount('job1', 'airtable', 'Videos');
      await linkIndex.incrementFailCount('job1', 'webflow', 'videos');
      
      expect(await linkIndex.getFailCount('job1', 'airtable', 'Videos')).toBe(1);
      expect(await linkIndex.getFailCount('job1', 'webflow', 'videos')).toBe(1);
    });
  });

  describe('Conflicts', () => {
    it('should insert and retrieve conflicts', async () => {
      const conflict: Conflict = {
        conflictId: 'conflict1',
        jobId: 'job1',
        sourceAdapter: 'airtable',
        sourceTable: 'Videos',
        sourceId: 'rec123',
        destAdapter: 'webflow',
        destTable: 'videos',
        destId: 'vid456',
        sourcePayload: { id: 'rec123', name: 'Video A' },
        destPayload: { id: 'vid456', name: 'Video B' },
        detectedAt: new Date(),
      };

      await linkIndex.insertConflict(conflict);

      const conflicts = await linkIndex.getConflicts('job1');
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].conflictId).toBe('conflict1');
    });

    it('should resolve conflicts', async () => {
      const conflict: Conflict = {
        conflictId: 'conflict1',
        jobId: 'job1',
        sourceAdapter: 'airtable',
        sourceTable: 'Videos',
        sourceId: 'rec123',
        destAdapter: 'webflow',
        destTable: 'videos',
        destId: 'vid456',
        sourcePayload: {},
        destPayload: {},
        detectedAt: new Date(),
      };

      await linkIndex.insertConflict(conflict);
      await linkIndex.resolveConflict('conflict1');

      const conflicts = await linkIndex.getConflicts('job1');
      expect(conflicts).toHaveLength(0);
    });
  });

  describe('Job State', () => {
    it('should disable and check job state', async () => {
      expect(await linkIndex.isJobDisabled('job1')).toBe(false);

      await linkIndex.setJobDisabled('job1', new Date());
      expect(await linkIndex.isJobDisabled('job1')).toBe(true);
    });
  });

  describe('Run Logs', () => {
    it('should insert and retrieve run summaries', async () => {
      const run: RunSummary = {
        runId: 'run1',
        jobId: 'job1',
        startedAt: new Date(),
        endedAt: new Date(),
        status: 'success',
        summaryJson: { upserts: 5 },
      };

      await linkIndex.insertRun(run);
      
      // Note: interface doesn't have getRun, but implementations might
      // This test verifies insertRun doesn't throw
    });
  });
});
```

**Benefits**:
- Ensures all implementations behave identically
- Catches bugs when adding new implementations
- Documents expected behavior
- Can be run against any LinkIndex implementation

---

### 2. **SQLite-Specific Unit Tests**
**Purpose**: Test SQLite-specific features, edge cases, and database operations.

**Location**: `packages/linkindex-sqlite/__tests__/sqlite-link-index.test.ts`

```typescript
describe('SqliteLinkIndex', () => {
  let linkIndex: SqliteLinkIndex;
  let dbPath: string;

  beforeEach(async () => {
    // Use temporary file for each test
    dbPath = path.join(os.tmpdir(), `test-${Date.now()}.db`);
    linkIndex = new SqliteLinkIndex(dbPath, {
      jobId: 'test-job',
      sideA: { adapter: 'airtable', table: 'Videos', sideKey: 'airtable' },
      sideB: { adapter: 'webflow', table: 'videos', sideKey: 'webflow' },
    });
    await linkIndex.initialize();
  });

  afterEach(async () => {
    await linkIndex.close();
    // Clean up temp file
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  describe('Database Initialization', () => {
    it('should create tables on first use', async () => {
      // Tables should be created by initialize()
      // Verify by checking if we can insert data
      await linkIndex.upsertLink(
        'airtable', 'Videos', 'rec123',
        'webflow', 'videos', 'vid456'
      );
      
      const destId = await linkIndex.findDest('airtable', 'Videos', 'rec123');
      expect(destId).toBe('vid456');
    });

    it('should handle existing database with tables', async () => {
      // Create tables
      await linkIndex.initialize();
      
      // Close and reopen
      await linkIndex.close();
      const linkIndex2 = new SqliteLinkIndex(dbPath, {
        jobId: 'test-job',
        sideA: { adapter: 'airtable', table: 'Videos', sideKey: 'airtable' },
        sideB: { adapter: 'webflow', table: 'videos', sideKey: 'webflow' },
      });
      await linkIndex2.initialize();
      
      // Should still have data
      const destId = await linkIndex2.findDest('airtable', 'Videos', 'rec123');
      expect(destId).toBe('vid456');
      
      await linkIndex2.close();
    });
  });

  describe('Transactions', () => {
    it('should handle concurrent operations', async () => {
      // Test that upsertLink is atomic
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(
          linkIndex.upsertLink(
            'airtable', 'Videos', `rec${i}`,
            'webflow', 'videos', `vid${i}`
          )
        );
      }
      await Promise.all(promises);

      // Verify all links were created
      for (let i = 0; i < 10; i++) {
        const destId = await linkIndex.findDest('airtable', 'Videos', `rec${i}`);
        expect(destId).toBe(`vid${i}`);
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle special characters in IDs', async () => {
      const specialId = 'rec:123:456';
      await linkIndex.upsertLink(
        'airtable', 'Videos', specialId,
        'webflow', 'videos', 'vid456'
      );
      
      const destId = await linkIndex.findDest('airtable', 'Videos', specialId);
      expect(destId).toBe('vid456');
    });

    it('should handle very long IDs', async () => {
      const longId = 'a'.repeat(1000);
      await linkIndex.upsertLink(
        'airtable', 'Videos', longId,
        'webflow', 'videos', 'vid456'
      );
      
      const destId = await linkIndex.findDest('airtable', 'Videos', longId);
      expect(destId).toBe('vid456');
    });
  });
});
```

**Benefits**:
- Tests database-specific behavior
- Tests edge cases and error conditions
- Verifies transaction handling
- Tests persistence across connections

---

### 3. **Integration Tests with SyncEngine**
**Purpose**: Verify LinkIndex works correctly in the full sync flow.

**Location**: `packages/core/__tests__/engine.sqlite.test.ts` or extend existing tests

```typescript
describe('SyncEngine with SQLite LinkIndex', () => {
  let linkIndex: SqliteLinkIndex;
  let dbPath: string;

  beforeEach(async () => {
    dbPath = path.join(os.tmpdir(), `test-${Date.now()}.db`);
    linkIndex = new SqliteLinkIndex(dbPath, {
      jobId: 'test-job',
      sideA: { adapter: 'airtable', table: 'Videos', sideKey: 'airtable' },
      sideB: { adapter: 'webflow', table: 'videos', sideKey: 'webflow' },
    });
    await linkIndex.initialize();
  });

  afterEach(async () => {
    await linkIndex.close();
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  function createTestEngine(config?: Partial<JobConfig>) {
    const adapterA = new InMemoryAdapter();
    const adapterB = new InMemoryAdapter();

    const defaultConfig: JobConfig = {
      jobId: 'test-job',
      sideA: {
        adapter: adapterA,
        adapterName: 'airtable',
        tableName: 'Videos',
        sideKey: 'airtable',
      },
      sideB: {
        adapter: adapterB,
        adapterName: 'webflow',
        tableName: 'videos',
        sideKey: 'webflow',
      },
      mapperAtoB: new IdentityMapper(),
      mapperBtoA: new IdentityMapper(),
      linkIndex,
    };

    return {
      engine: new SyncEngine({ ...defaultConfig, ...config }),
      adapterA,
      adapterB,
      linkIndex,
    };
  }

  it('should sync records and persist links in SQLite', async () => {
    const { engine, adapterA, adapterB } = createTestEngine();

    adapterA.addRecord({ id: 'rec1', name: 'Video 1', updatedAt: Date.now() });
    await engine.run();

    // Verify link persisted
    const destId = await linkIndex.findDest('airtable', 'Videos', 'rec1');
    expect(destId).toBe('rec1'); // Identity mapper preserves ID
  });

  it('should persist cursors across runs', async () => {
    const { engine, adapterA } = createTestEngine();

    // First run
    adapterA.addRecord({ id: 'rec1', name: 'Video 1', updatedAt: Date.now() });
    await engine.run();

    const cursor1 = await linkIndex.loadCursor('test-job', 'airtable', 'Videos');
    expect(cursor1.value).not.toBeNull();

    // Second run - should advance cursor
    adapterA.addRecord({ id: 'rec2', name: 'Video 2', updatedAt: Date.now() });
    await engine.run();

    const cursor2 = await linkIndex.loadCursor('test-job', 'airtable', 'Videos');
    expect(cursor2.value).not.toBe(cursor1.value);
  });

  it('should track fail counts and disable jobs', async () => {
    const { engine, adapterA, adapterB } = createTestEngine({
      retries: {
        maxAttempts: 2,
        backoffSec: 0.1,
        disableJobAfter: 3,
      },
    });

    // Make adapterB fail
    jest.spyOn(adapterB, 'applyChanges').mockRejectedValue(new Error('API Error'));

    adapterA.addRecord({ id: 'rec1', name: 'Video 1', updatedAt: Date.now() });

    // Run multiple times to accumulate failures
    for (let i = 0; i < 3; i++) {
      await engine.run();
    }

    // Job should be disabled
    expect(await linkIndex.isJobDisabled('test-job')).toBe(true);
  });

  it('should persist conflicts for manual resolution', async () => {
    const { engine, adapterA, adapterB } = createTestEngine({
      conflictPolicy: 'manual',
    });

    // Create a record in both sides
    adapterA.addRecord({ id: 'rec1', name: 'Video A', updatedAt: 1000 });
    await engine.run(); // Sync A → B

    // Modify both sides simultaneously
    adapterA.addRecord({ id: 'rec1', name: 'Video A Updated', updatedAt: 2000 });
    adapterB.addRecord({ id: 'rec1', name: 'Video B Updated', updatedAt: 2000 });

    await engine.run(); // Should detect conflict

    const conflicts = await linkIndex.getConflicts('test-job');
    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts[0].sourceId).toBe('rec1');
    expect(conflicts[0].destId).toBe('rec1');
  });
});
```

**Benefits**:
- Tests real-world usage scenarios
- Verifies integration with SyncEngine
- Tests complex workflows (cursors, fail counts, conflicts)
- Catches integration bugs

---

## Test Execution Strategy

### Running Contract Tests
```bash
# Test all implementations
npm test -- linkindex.contract.test.ts

# Test specific implementation
npm test -- linkindex.contract.test.ts -t "SQLite"
```

### Running SQLite-Specific Tests
```bash
cd packages/linkindex-sqlite
npm test
```

### Running Integration Tests
```bash
cd packages/core
npm test -- engine.sqlite.test.ts
```

### CI/CD Integration
- Run contract tests against all implementations
- Run SQLite-specific tests with in-memory database
- Run integration tests with temporary database files
- Clean up temp files after tests

---

## Test Coverage Goals

- **Contract Tests**: 100% interface coverage
- **SQLite Tests**: 100% code coverage for SQLite adapter
- **Integration Tests**: Critical paths and edge cases

---

## Benefits of This Approach

1. **Consistency**: Contract tests ensure all implementations behave the same
2. **Confidence**: Multiple test levels catch different types of bugs
3. **Maintainability**: Easy to add new LinkIndex implementations
4. **Documentation**: Tests serve as usage examples
5. **Regression Prevention**: Catches bugs when refactoring

---

## Future Enhancements

- **Performance Tests**: Benchmark different implementations
- **Concurrency Tests**: Test multi-threaded access (if applicable)
- **Migration Tests**: Test schema migrations (when implemented)
- **Backup/Restore Tests**: Test database backup/restore (if applicable)

