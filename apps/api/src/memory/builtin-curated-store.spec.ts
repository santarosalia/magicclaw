import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BuiltinCuratedStore } from "./builtin-curated-store.js";

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
      expect(result.success).toBe(true);

      const snapshotAfter = store.getSystemPromptBlock();
      expect(snapshotAfter).toBe(snapshotBefore);

      const live = store.getLiveEntries("memory");
      expect(live.some((e) => e.includes("Korean"))).toBe(true);
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
      expect(result.success).toBe(true);

      const storeB = new BuiltinCuratedStore("user-a", 500, 500, true, true);
      storeB.loadFromDisk();
      expect(storeB.getSystemPromptBlock()).toContain("Alice");
    } finally {
      if (prev === undefined) delete process.env.MAGICCLAW_HOME;
      else process.env.MAGICCLAW_HOME = prev;
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("applyBatch removes and adds atomically within char limit", () => {
    const home = mkdtempSync(join(tmpdir(), "magicclaw-mem-"));
    const prev = process.env.MAGICCLAW_HOME;
    process.env.MAGICCLAW_HOME = home;

    try {
      const store = new BuiltinCuratedStore("user-a", 200, 200, true, true);
      store.loadFromDisk();
      store.add("memory", "Old convention about tabs.");
      const result = store.applyBatch("memory", [
        { action: "remove", old_text: "Old convention" },
        { action: "add", content: "Project uses spaces, width 2." },
      ]);
      expect(result.success).toBe(true);
      expect(store.getLiveEntries("memory")).toEqual([
        "Project uses spaces, width 2.",
      ]);
    } finally {
      if (prev === undefined) delete process.env.MAGICCLAW_HOME;
      else process.env.MAGICCLAW_HOME = prev;
      rmSync(home, { recursive: true, force: true });
    }
  });
});
