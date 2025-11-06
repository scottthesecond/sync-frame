## SyncFrame Master Plan

---

### 1 – High-Level Architecture  
| Layer | npm Scope | Responsibility | Depends On |
|-------|----------|----------------|------------|
| **Core** | `@syncframe/core` | Contracts, sync engine, retry/throttle logic | none |
| **Adapters** | `@syncframe/adapter-*` | Translate remote API ⇆ `ChangeSet` | Core |
| **LinkIndex** | `@syncframe/linkindex-*` | Persist links, cursors, run logs | Core |
| **CLI** | `@syncframe/cli` | Parse JSONC / env, load plug-ins, invoke engine | Core + adapters + linkindex |

> Core never imports adapters; CLI wires everything together at runtime.

---

### 2 – Core Contracts  
```ts
// types only – no implementation
interface Cursor       { value: string | null }
interface ChangeSet    { upserts: Record[]; deletes: RecordID[] }
interface SourceAdapter {
  getUpdates(cursor: Cursor): Promise<ChangeSet>
  applyChanges(cs: ChangeSet): Promise<void>
  serializeCursor(cur: Cursor): string
}
interface Mapper {
  toDest(srcRec: Record): Record
  toSource(destRec: Record): Record
  //Note: Concrete Mapper implementations live in the job-specific files referenced in JSONC config
}
interface LinkIndex {
  /** links */
  upsertLink(
    sourceAdapter: string, sourceTable: string, sourceId: string,
    destAdapter: string, destTable: string, destId: string
  ): Promise<void>
  findDest(sourceAdapter: string, sourceTable: string, sourceId: string): Promise<string | null>
  findSource(destAdapter: string, destTable: string, destId: string): Promise<string | null>
  /** cursors */
  loadCursor(jobId: string, adapter: string, table: string): Promise<Cursor>
  saveCursor(jobId: string, adapter: string, table: string, cursor: Cursor): Promise<void>
  /** job state & runs */
  setJobDisabled(jobId: string, ts: Date): Promise<void>
  isJobDisabled(jobId: string): Promise<boolean>
  insertRun(run: RunSummary): Promise<void>
  /** fail count tracking */
  incrementFailCount(jobId: string, adapter: string, table: string): Promise<number>
  resetFailCount(jobId: string, adapter: string, table: string): Promise<void>
  getFailCount(jobId: string, adapter: string, table: string): Promise<number>
  /** conflicts (for manual resolution) */
  insertConflict(conflict: Conflict): Promise<void>
  getConflicts(jobId: string): Promise<Conflict[]>
  resolveConflict(conflictId: string): Promise<void>
}
```


---

### 3 – Database Schema (SQLite / Postgres impls)  
```sql
links(
  src_adapter   TEXT,
  src_table     TEXT,
  src_id        TEXT,
  dest_adapter  TEXT,
  dest_table    TEXT,
  dest_id       TEXT,
  last_sync_ts  TIMESTAMP,
  PRIMARY KEY (src_adapter, src_table, src_id,
               dest_adapter, dest_table, dest_id)
);

cursors(
  job_id        TEXT,
  adapter       TEXT,
  table_name    TEXT,
  cursor_token  TEXT,
  fail_count    INT    DEFAULT 0,
  disabled_at   TIMESTAMP NULL,
  PRIMARY KEY (job_id, adapter, table_name)
);

runs(
  run_id        TEXT PRIMARY KEY,
  job_id        TEXT,
  started_at    TIMESTAMP,
  ended_at      TIMESTAMP,
  status        TEXT,                   -- success / partial / failed
  summary_json  JSONB
);

conflicts(                       -- for conflict_policy=manual
  conflict_id   TEXT PRIMARY KEY,
  job_id        TEXT,
  src_adapter   TEXT,
  src_table     TEXT,
  src_id        TEXT,
  dest_adapter  TEXT,
  dest_table    TEXT,
  dest_id       TEXT,
  src_payload   JSONB,           -- full source record
  dest_payload  JSONB,           -- full destination record
  detected_at   TIMESTAMP
);
```

---

### 4 – JSONC Configuration  
```jsonc
{
  "linkindex": {
    "driver": "sqlite",
    "conn": "./syncframe.db"  // DSN or path
  },
  "jobs": [
    {
      "id": "airtable-revel__webflow-videos",
      "schedule": "*/5 * * * *",  // cron; omit for manual/CLI-only
      "sides": {
        "airtable": {
          "adapter": "airtable",
          "table": "Videos",
          "creds": {
            "apiKey": "${AIRTABLE_TOKEN}",
            "baseId": "app123"
          },
          "throttle": {  // optional; defaults shown
            "max_reqs": 50,
            "interval_sec": 60,
            "batch_size": 10
          }
        },
        "webflow": {
          "adapter": "webflow",
          "collection": "videos",
          "creds": {
            "token": "${WEBFLOW_TOKEN}"
          }
        }
      },
      "mappings": {  // mandatory A→B and B→A
        "airtable→webflow": "./maps/at_to_wf.js",
        "webflow→airtable": "./maps/wf_to_at.js"
      },
      "retries": {  // optional; defaults shown
        "max_attempts": 5,
        "backoff_sec": 30,
        "disable_job_after": 20
      },
      "conflict_policy": "last_writer_wins"  // or "manual"
    }
  ]
}
```

*Environment variables are resolved by CLI before objects reach core.*

---

### 5 – Engine Flow (per job)  
1. **Skip** if `disabled_at` is non-NULL.  
2. **Pull phase:**  
   - `getUpdates(cursorA)` → `ChangeSetA`  
   - `getUpdates(cursorB)` → `ChangeSetB`  
3. **Transform & Dedup:**  
   - map each record through appropriate `Mapper` function.  
   - use `LinkIndex` to find opposite IDs; prevent echoes.  
   - detect conflicts: a conflict occurs when BOTH records changed in the same cycle.  
   - for `last_writer_wins`: compare timestamps, use newer record.  
   - for `manual`: record in `conflicts` table with both payloads, skip change.  
4. **Push phase (batched):**  
   - obey per-side `batch_size` & `throttle` window.  
   - retry with exponential back-off ≤ `max_attempts`.  
   - on retry failure after `max_attempts`, increment `fail_count` for that side.  
5. **Persist:** cursors, link upserts, `runs` summary row.  
   - on success: reset `fail_count` for both sides.  
6. **Error handling:**  
   - after `max_attempts` failures, increment `fail_count` for the failed side(s).  
   - if `fail_count` ≥ `disable_job_after` for any side, set `disabled_at` timestamp for the job.  

---

### 6 – Error / Deletion / Conflict Rules  
| Area | Decision |
|------|----------|
| **Soft delete only** | Adapters map a boolean `isDeleted` (or similar). Dest adapter decides whether to hard-delete or soft-flag. |
| **Conflict policies** | `last_writer_wins` (timestamp compare) **or** `manual` → record in `conflicts` table with both full payloads; change skipped. Conflicts only detected when BOTH records changed in the same sync cycle. |
| **Retry** | Configurable; exponential back-off starting at `backoff_sec`. |
| **Throttle** | Sliding-window counter: `max_reqs` within `interval_sec`. |

---

### 7 – Observability  
* Structured JSON to **stdout** (for real-time tailing).  
* Row in `runs` table summarising: totals, retries, duration, status, top-level error list.  
* Prune `runs` older than 30 days via nightly CLI flag (`syncframe prune`).

---

### 8 – Testing Strategy  
| Layer | Automated via LLM-generated code | Human setup |
|-------|----------------------------------|-------------|
| Core engine | unit/integration using **InMemoryAdapter** & **InMemoryLinkIndex** (no external APIs) | – |
| Adapter contract tests | fixtures auto-generated by LLM; replay with `msw/nock` | create sandbox Airtable base & Webflow collection, hand API keys to CI secrets |
| CLI end-to-end | LLM can script Docker Compose (SQLite + node) | verify manually the first run; thereafter CI |

---

### 9 – Security & Secrets  
* .env files only (12-factor); no secret manager yet.  
* Adapters must **not** log raw creds.

---

### 10 – Open Items Deferred  
* Schema migrations (future).  
* Concurrency / job locking (future).  
* Metrics endpoint (future).  

---

## Implementation To-Do List

| Order | Task | LLM-assist? | Human notes |
|-------|------|-------------|-------------|
| 1 | **Init monorepo**  | ✅ | – |
| 2 | Scaffold `@syncframe/core` with typed interfaces & empty engine | ✅ | – |
| 3 | Implement **InMemoryAdapter** & **InMemoryLinkIndex** for tests | ✅ | – |
| 4 | Write engine logic (pull-map-push-persist loop, retry, throttle) | ✅ | – |
| 5 | Create `@syncframe/linkindex-sqlite` (tables above, Drizzle) | ✅ | – |
| 6 | Build `@syncframe/cli` (JSONC parse, env expand, dynamic import) | 🔄 | – |
| 7 | Draft **example JSONC** + dummy mapper fn | 🔄 | – |
| 8 | Manual smoke test with in-memory adapters (`syncframe --once`) | – | Dev runs locally |
| 9 | Build `adapter-airtable` (read/write, cursor via offset token) | Partial | Needs sandbox base & API key |
| 10 | Build `adapter-webflow` (read/write, cursor via `updated_on`) | Partial | Needs sandbox site & token |
| 11 | Integration test Airtable↔Webflow through SQLite LinkIndex | – | Dev validates data |
| 12 | Add `runs` persistence & stdout JSON logger | ✅ | – |
| 13 | Document everything (`DESIGN.md`, README with YAML schema) | ✅ | – |
| 14 | Optional: write prune script & GitHub Actions CI pipeline | ✅ | – |

---

