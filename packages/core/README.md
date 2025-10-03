# @syncframe/core

Core contracts, sync engine, and retry/throttle logic for SyncFrame.

## Overview

This package contains:

- **Type Definitions**: Core interfaces (`Cursor`, `ChangeSet`, `SourceAdapter`, `Mapper`, `LinkIndex`)
- **SyncEngine**: Orchestrates bidirectional synchronization between two data sources
- **Configuration Types**: Job configuration, retry policies, throttle settings

## Architecture Principle

**Core never imports adapters.** The CLI or application code is responsible for:
1. Loading adapter implementations
2. Configuring the `SyncEngine` with concrete adapter instances
3. Executing sync jobs

## Key Interfaces

### `SourceAdapter`

Adapters translate between SyncFrame's `ChangeSet` protocol and remote APIs:

```typescript
interface SourceAdapter {
  getUpdates(cursor: Cursor): Promise<{ changes: ChangeSet; nextCursor: Cursor }>;
  applyChanges(changes: ChangeSet): Promise<void>;
  serializeCursor(cursor: Cursor): string;
}
```

### `LinkIndex`

Persistence layer for record links, cursors, and run logs:

```typescript
interface LinkIndex {
  upsertLink(sourceId: string, destId: string): Promise<void>;
  findDest(sourceId: string): Promise<string | null>;
  findSource(destId: string): Promise<string | null>;
  loadCursor(jobId: string, side: SideKey): Promise<Cursor>;
  saveCursor(jobId: string, side: SideKey, cursor: Cursor): Promise<void>;
  setJobDisabled(jobId: string, ts: Date): Promise<void>;
  isJobDisabled(jobId: string): Promise<boolean>;
  insertRun(run: RunSummary): Promise<void>;
}
```

### `Mapper`

Maps records between two data sources:

```typescript
interface Mapper {
  toDest(srcRec: Record): Record;
  toSource(destRec: Record): Record;
}
```

## Usage Example

```typescript
import { SyncEngine } from "@syncframe/core";

const engine = new SyncEngine({
  jobId: "my-sync-job",
  sideA: {
    adapter: mySourceAdapter,
    sideKey: "source",
  },
  sideB: {
    adapter: myDestAdapter,
    sideKey: "dest",
  },
  mapperAtoB: myMapperAtoB,
  mapperBtoA: myMapperBtoA,
  linkIndex: myLinkIndex,
});

await engine.run();
```

## Development Status

This is a scaffolded implementation. Full sync logic (pull-map-push-persist) will be implemented in subsequent steps.

## License

MIT


