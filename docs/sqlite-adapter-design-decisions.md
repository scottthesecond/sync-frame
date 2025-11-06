# SQLite LinkIndex Adapter - Design Decisions

## Decision 1: Adapter/Table Context for Links

**Problem**: Database schema requires `src_adapter`, `src_table`, `dest_adapter`, `dest_table`, but the `LinkIndex` interface only uses `sourceId` and `destId`.

| Option | Approach | Pros | Cons |
|--------|----------|------|------|
| **A** | Store context at construction | ✅ No core changes<br>✅ Simple mapping<br>✅ Matches one-instance-per-job | ❌ One instance per job<br>❌ Different constructor signature |
| **B** | Extend LinkIndex interface | ✅ Schema matches interface<br>✅ Multi-job instances possible<br>✅ Flexible for queries | ❌ Requires core changes<br>❌ Breaking change<br>❌ More verbose API |
| **C** | Composite key encoding | ✅ No interface changes<br>✅ Works with existing code | ❌ Schema doesn't match masterplan<br>❌ Parsing overhead<br>❌ Hard to query |

**Recommendation**: **Option A** - Store context at construction time.

---

## Decision 2: Conflicts Table Implementation

**Problem**: Schema includes `conflicts` table, but engine doesn't use it yet.

| Option | Approach | Pros | Cons |
|--------|----------|------|------|
| **A** | Create schema only (no methods) | ✅ Schema ready for future<br>✅ Minimal work now<br>✅ No unused interface | ❌ Can't use until engine updated |
| **B** | Implement full interface now | ✅ Complete implementation<br>✅ Ready for engine use | ❌ Unused until engine changes<br>❌ Interface may need changes |
| **C** | Skip conflicts table | ✅ Less initial work<br>✅ No unused schema | ❌ Requires migration later<br>❌ Doesn't match masterplan |

**Recommendation**: **Option A** - Create schema, defer methods.

---

## Decision 3: Fail Count Tracking

**Problem**: Schema has `fail_count` in cursors table, but interface doesn't expose it.

| Option | Approach | Pros | Cons |
|--------|----------|------|------|
| **A** | Store silently (don't expose) | ✅ Data available for future<br>✅ No interface changes | ❌ Unused for now<br>❌ Need to define increment logic |
| **B** | Expose in interface | ✅ Fully functional now<br>✅ Engine can use it | ❌ Engine doesn't use it yet<br>❌ Requires interface changes |
| **C** | Ignore completely | ✅ Simplest implementation<br>✅ No unused columns | ❌ Loses masterplan feature<br>❌ Harder to add later |

**Recommendation**: **Option A** - Store it silently for future use.

---

## Decision 4: ORM/Database Library Choice

**Problem**: Need a library to interact with SQLite.

| Option | Library | Pros | Cons |
|--------|---------|------|------|
| **A** | Drizzle ORM | ✅ Type-safe<br>✅ Matches masterplan<br>✅ Good TypeScript support | ❌ Learning curve<br>❌ Additional dependency |
| **B** | better-sqlite3 (raw SQL) | ✅ Fast, synchronous<br>✅ Simple queries<br>✅ Lightweight | ❌ No type safety<br>❌ Manual SQL<br>❌ Error-prone |
| **C** | sql.js (WASM) | ✅ Pure JavaScript<br>✅ Browser compatible | ❌ Slower<br>❌ Larger bundle<br>❌ Not needed for Node |
| **D** | Kysely | ✅ Type-safe<br>✅ No ORM overhead | ❌ Additional dependency<br>❌ Not in masterplan |

**Recommendation**: **Option A** - Drizzle ORM (matches masterplan).

---

## Decision 5: Schema Migration Strategy

**Problem**: Need to create tables on first use.

| Option | Approach | Pros | Cons |
|--------|----------|------|------|
| **A** | Auto-create on first use | ✅ Simple, no migration system<br>✅ Works out of box<br>✅ Good for v0.1 | ❌ No versioning<br>❌ Can't handle schema changes |
| **B** | Simple migration script | ✅ Can handle future changes<br>✅ Version tracking possible | ❌ More complex<br>❌ May be overkill now |
| **C** | Manual migration | ✅ No migration logic needed<br>✅ Full user control | ❌ Poor UX<br>❌ Error-prone<br>❌ Not suitable for CLI |

**Recommendation**: **Option A** - Auto-create on first use (can upgrade to Option B later).

---

## Decision 6: Connection Handling

**Problem**: How to manage SQLite database connection.

| Option | Approach | Pros | Cons |
|--------|----------|------|------|
| **A** | Single connection per instance | ✅ Simple lifecycle<br>✅ One connection per job<br>✅ Easy to manage | ❌ Multiple instances = multiple connections<br>❌ Need explicit cleanup |
| **B** | Connection pooling | ✅ Efficient for many jobs<br>✅ Better resource usage | ❌ Overkill for SQLite<br>❌ Much more complex<br>❌ SQLite is single-writer |
| **C** | Open/close per operation | ✅ No connection management<br>✅ Always fresh | ❌ High overhead<br>❌ Slower<br>❌ Not suitable for frequent ops |

**Recommendation**: **Option A** - Single connection per instance.

---

## Decision 7: Transaction Strategy

**Problem**: Some operations should be atomic (e.g., upsertLink updates both directions).

| Option | Approach | Pros | Cons |
|--------|----------|------|------|
| **A** | Use transactions for multi-step ops | ✅ Data integrity<br>✅ Prevents partial updates | ❌ Slightly more complex<br>❌ SQLite locks during writes |
| **B** | No transactions (single statements) | ✅ Simpler code<br>✅ Faster for simple ops | ❌ Risk of partial updates<br>❌ Data inconsistency possible |
| **C** | Batch transaction support | ✅ Flexible<br>✅ Optimal performance | ❌ Most complex<br>❌ Interface changes needed |

**Recommendation**: **Option A** - Use transactions for multi-step operations.

---

## Final Recommendations Summary

| Decision | Recommended Option | Rationale |
|----------|-------------------|-----------|
| Adapter/Table Context | **A** - Construction-time | Keeps interface unchanged, matches one-instance-per-job pattern |
| Conflicts Table | **A** - Schema only | Ready for future, minimal work now |
| Fail Count | **A** - Store silently | Available for future use without interface changes |
| ORM Choice | **A** - Drizzle | Matches masterplan, type-safe, good DX |
| Migrations | **A** - Auto-create | Simple for v0.1, can upgrade later |
| Connection Handling | **A** - One per instance | Simple, appropriate for SQLite |
| Transactions | **A** - Use for multi-step | Ensures data integrity |

---

## Implementation Notes

### Constructor Signature
```typescript
constructor(
  dbPath: string,
  jobConfig: {
    jobId: string;
    sideA: { adapter: string; table: string; sideKey: string };
    sideB: { adapter: string; table: string; sideKey: string };
  }
)
```

### Key Implementation Details
- Use Drizzle ORM for type-safe queries
- Auto-create tables on first use (check if exist, create if not)
- Store adapter/table context at construction, map internally
- Use transactions for `upsertLink` (updates both directions)
- Track `fail_count` but don't expose in interface yet
- Create `conflicts` table but no interface methods yet

