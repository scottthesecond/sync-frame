/**
 * Contract tests for LinkIndex implementations.
 * These tests verify that all LinkIndex implementations (InMemory, SQLite, etc.)
 * behave identically according to the interface contract.
 */

import type { LinkIndex, Cursor, RunSummary, Conflict } from "@syncframe/core";
import { InMemoryLinkIndex } from "../src/in-memory-link-index";

/**
 * Test suite that works with any LinkIndex implementation.
 */
function runLinkIndexContractTests(createLinkIndex: () => LinkIndex, implementationName: string) {
  describe(`LinkIndex Contract Tests - ${implementationName}`, () => {
    let linkIndex: LinkIndex;

    beforeEach(() => {
      linkIndex = createLinkIndex();
      // Clear any existing data if the implementation supports it
      if (linkIndex instanceof InMemoryLinkIndex) {
        linkIndex.clear();
      }
    });

    describe("Links", () => {
      it("should upsert and retrieve links", async () => {
        await linkIndex.upsertLink(
          "airtable",
          "Videos",
          "rec123",
          "webflow",
          "videos",
          "vid456"
        );

        const destId = await linkIndex.findDest("airtable", "Videos", "rec123");
        expect(destId).toBe("vid456");

        const sourceId = await linkIndex.findSource("webflow", "videos", "vid456");
        expect(sourceId).toBe("rec123");
      });

      it("should update existing links", async () => {
        // Initial link
        await linkIndex.upsertLink(
          "airtable",
          "Videos",
          "rec123",
          "webflow",
          "videos",
          "vid456"
        );

        // Update link
        await linkIndex.upsertLink(
          "airtable",
          "Videos",
          "rec123",
          "webflow",
          "videos",
          "vid789"
        );

        const destId = await linkIndex.findDest("airtable", "Videos", "rec123");
        expect(destId).toBe("vid789");
      });

      it("should handle bidirectional lookups", async () => {
        await linkIndex.upsertLink(
          "airtable",
          "Videos",
          "rec123",
          "webflow",
          "videos",
          "vid456"
        );

        // Source → Dest
        expect(await linkIndex.findDest("airtable", "Videos", "rec123")).toBe("vid456");

        // Dest → Source
        expect(await linkIndex.findSource("webflow", "videos", "vid456")).toBe("rec123");
      });

      it("should return null for non-existent links", async () => {
        const destId = await linkIndex.findDest("airtable", "Videos", "nonexistent");
        expect(destId).toBeNull();

        const sourceId = await linkIndex.findSource("webflow", "videos", "nonexistent");
        expect(sourceId).toBeNull();
      });
    });

    describe("Cursors", () => {
      it("should save and load cursors", async () => {
        const cursor: Cursor = { value: "cursor123" };
        await linkIndex.saveCursor("job1", "airtable", "Videos", cursor);

        const loaded = await linkIndex.loadCursor("job1", "airtable", "Videos");
        expect(loaded).toEqual(cursor);
      });

      it("should return null cursor for non-existent cursors", async () => {
        const cursor = await linkIndex.loadCursor("job1", "airtable", "Videos");
        expect(cursor).toEqual({ value: null });
      });

      it("should handle cursor updates", async () => {
        await linkIndex.saveCursor("job1", "airtable", "Videos", { value: "cursor1" });
        await linkIndex.saveCursor("job1", "airtable", "Videos", { value: "cursor2" });

        const cursor = await linkIndex.loadCursor("job1", "airtable", "Videos");
        expect(cursor.value).toBe("cursor2");
      });

      it("should track cursors per job, adapter, and table independently", async () => {
        await linkIndex.saveCursor("job1", "airtable", "Videos", { value: "cursor1" });
        await linkIndex.saveCursor("job1", "webflow", "videos", { value: "cursor2" });
        await linkIndex.saveCursor("job2", "airtable", "Videos", { value: "cursor3" });

        expect((await linkIndex.loadCursor("job1", "airtable", "Videos")).value).toBe("cursor1");
        expect((await linkIndex.loadCursor("job1", "webflow", "videos")).value).toBe("cursor2");
        expect((await linkIndex.loadCursor("job2", "airtable", "Videos")).value).toBe("cursor3");
      });
    });

    describe("Fail Count Tracking", () => {
      it("should increment fail count", async () => {
        const count1 = await linkIndex.incrementFailCount("job1", "airtable", "Videos");
        expect(count1).toBe(1);

        const count2 = await linkIndex.incrementFailCount("job1", "airtable", "Videos");
        expect(count2).toBe(2);
      });

      it("should reset fail count", async () => {
        await linkIndex.incrementFailCount("job1", "airtable", "Videos");
        await linkIndex.incrementFailCount("job1", "airtable", "Videos");

        await linkIndex.resetFailCount("job1", "airtable", "Videos");

        const count = await linkIndex.getFailCount("job1", "airtable", "Videos");
        expect(count).toBe(0);
      });

      it("should track fail counts per cursor independently", async () => {
        await linkIndex.incrementFailCount("job1", "airtable", "Videos");
        await linkIndex.incrementFailCount("job1", "webflow", "videos");

        expect(await linkIndex.getFailCount("job1", "airtable", "Videos")).toBe(1);
        expect(await linkIndex.getFailCount("job1", "webflow", "videos")).toBe(1);
      });

      it("should return 0 for non-existent fail counts", async () => {
        const count = await linkIndex.getFailCount("job1", "airtable", "Videos");
        expect(count).toBe(0);
      });
    });

    describe("Conflicts", () => {
      it("should insert and retrieve conflicts", async () => {
        const conflict: Conflict = {
          conflictId: "conflict1",
          jobId: "job1",
          sourceAdapter: "airtable",
          sourceTable: "Videos",
          sourceId: "rec123",
          destAdapter: "webflow",
          destTable: "videos",
          destId: "vid456",
          sourcePayload: { id: "rec123", name: "Video A" },
          destPayload: { id: "vid456", name: "Video B" },
          detectedAt: new Date(),
        };

        await linkIndex.insertConflict(conflict);

        const conflicts = await linkIndex.getConflicts("job1");
        expect(conflicts).toHaveLength(1);
        expect(conflicts[0].conflictId).toBe("conflict1");
        expect(conflicts[0].sourceId).toBe("rec123");
        expect(conflicts[0].destId).toBe("vid456");
      });

      it("should resolve conflicts", async () => {
        const conflict: Conflict = {
          conflictId: "conflict1",
          jobId: "job1",
          sourceAdapter: "airtable",
          sourceTable: "Videos",
          sourceId: "rec123",
          destAdapter: "webflow",
          destTable: "videos",
          destId: "vid456",
          sourcePayload: {},
          destPayload: {},
          detectedAt: new Date(),
        };

        await linkIndex.insertConflict(conflict);
        await linkIndex.resolveConflict("conflict1");

        const conflicts = await linkIndex.getConflicts("job1");
        expect(conflicts).toHaveLength(0);
      });

      it("should filter conflicts by job ID", async () => {
        const conflict1: Conflict = {
          conflictId: "conflict1",
          jobId: "job1",
          sourceAdapter: "airtable",
          sourceTable: "Videos",
          sourceId: "rec123",
          destAdapter: "webflow",
          destTable: "videos",
          destId: "vid456",
          sourcePayload: {},
          destPayload: {},
          detectedAt: new Date(),
        };

        const conflict2: Conflict = {
          conflictId: "conflict2",
          jobId: "job2",
          sourceAdapter: "airtable",
          sourceTable: "Videos",
          sourceId: "rec789",
          destAdapter: "webflow",
          destTable: "videos",
          destId: "vid999",
          sourcePayload: {},
          destPayload: {},
          detectedAt: new Date(),
        };

        await linkIndex.insertConflict(conflict1);
        await linkIndex.insertConflict(conflict2);

        const job1Conflicts = await linkIndex.getConflicts("job1");
        expect(job1Conflicts).toHaveLength(1);
        expect(job1Conflicts[0].conflictId).toBe("conflict1");
      });
    });

    describe("Job State", () => {
      it("should disable and check job state", async () => {
        expect(await linkIndex.isJobDisabled("job1")).toBe(false);

        await linkIndex.setJobDisabled("job1", new Date());
        expect(await linkIndex.isJobDisabled("job1")).toBe(true);
      });

      it("should track job state per job independently", async () => {
        await linkIndex.setJobDisabled("job1", new Date());

        expect(await linkIndex.isJobDisabled("job1")).toBe(true);
        expect(await linkIndex.isJobDisabled("job2")).toBe(false);
      });
    });

    describe("Run Logs", () => {
      it("should insert run summaries", async () => {
        const run: RunSummary = {
          runId: "run1",
          jobId: "job1",
          startedAt: new Date(),
          endedAt: new Date(),
          status: "success",
          summaryJson: { upserts: 5 },
        };

        await linkIndex.insertRun(run);
        // If implementation supports it, verify insertion
        if (linkIndex instanceof InMemoryLinkIndex) {
          const retrievedRun = linkIndex.getRun("run1");
          expect(retrievedRun).toBeDefined();
          expect(retrievedRun?.runId).toBe("run1");
        }
      });

      it("should handle multiple runs", async () => {
        const run1: RunSummary = {
          runId: "run1",
          jobId: "job1",
          startedAt: new Date(),
          endedAt: new Date(),
          status: "success",
          summaryJson: {},
        };

        const run2: RunSummary = {
          runId: "run2",
          jobId: "job1",
          startedAt: new Date(),
          endedAt: new Date(),
          status: "failed",
          summaryJson: {},
        };

        await linkIndex.insertRun(run1);
        await linkIndex.insertRun(run2);
        // Verify both were inserted
        if (linkIndex instanceof InMemoryLinkIndex) {
          const runs = linkIndex.getRunsForJob("job1");
          expect(runs.length).toBeGreaterThanOrEqual(2);
        }
      });
    });
  });
}

// Run tests for InMemoryLinkIndex
runLinkIndexContractTests(() => new InMemoryLinkIndex(), "InMemory");

// Future: Add SQLite tests here when SQLite adapter is built
// runLinkIndexContractTests(() => new SqliteLinkIndex(':memory:'), "SQLite");

