import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BuiltinCuratedStore } from "../dist/memory/builtin-curated-store.js";

describe("BuiltinCuratedStore", () => {
  it("adds entries and keeps frozen snapshot stable mid-session", () => {
    const home = mkdtempSync(join(tmpdir(), "magicclaw-mem-"));
    const prev = process.env.MAGICCLAW_HOME;
    process.env.MAGICCLAW_HOME = home;

    try {
      const store = new BuiltinCuratedStore("user-a", 500, 500, true, true);
      store.loadFromDisk();
      const snapshotBefore = store.getSystemPromptBlock();

      const result = store.add("memory", "User prefers Korean replies.");
      assert.equal(result.success, true);

      const snapshotAfter = store.getSystemPromptBlock();
      assert.equal(snapshotAfter, snapshotBefore);

      const live = store.getLiveEntries("memory");
      assert.ok(live.some((e) => e.includes("Korean")));
    } finally {
      if (prev === undefined) delete process.env.MAGICCLAW_HOME;
      else process.env.MAGICCLAW_HOME = prev;
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("persists to disk and reloads in a new session", () => {
    const home = mkdtempSync(join(tmpdir(), "magicclaw-mem-"));
    const prev = process.env.MAGICCLAW_HOME;
    process.env.MAGICCLAW_HOME = home;

    try {
      const storeA = new BuiltinCuratedStore("user-a", 500, 500, true, true);
      storeA.loadFromDisk();
      const result = storeA.add("user", "User's name is Alice.");
      assert.equal(result.success, true);

      const storeB = new BuiltinCuratedStore("user-a", 500, 500, true, true);
      storeB.loadFromDisk();
      const block = storeB.getSystemPromptBlock();
      assert.ok(block.includes("Alice"));
    } finally {
      if (prev === undefined) delete process.env.MAGICCLAW_HOME;
      else process.env.MAGICCLAW_HOME = prev;
      rmSync(home, { recursive: true, force: true });
    }
  });
});
