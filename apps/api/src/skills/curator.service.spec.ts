import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SkillStoreService } from "./skill-store.service.js";
import { SkillUsageService } from "./skill-usage.service.js";
import { CuratorService } from "./curator.service.js";
import { CuratorConfigStoreService } from "../store/curator-config-store.service.js";

describe("CuratorService", () => {
  let home: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "magicclaw-curator-"));
    prevHome = process.env.MAGICCLAW_HOME;
    process.env.MAGICCLAW_HOME = home;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.MAGICCLAW_HOME;
    else process.env.MAGICCLAW_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  });

  it("archives stale agent-created skills", () => {
    const usage = new SkillUsageService();
    const store = new SkillStoreService(usage);
    const configStore = new CuratorConfigStoreService();
    configStore.saveConfig({
      enabled: true,
      intervalHours: 0,
      minIdleHours: 0,
      staleAfterDays: 1,
      archiveAfterDays: 2,
    });

    store.createSkill({
      name: "old-skill",
      description: "An old workflow.",
      content: "## Procedure\nDo the thing.",
    });

    const staleAt = new Date(Date.now() - 5 * 86400 * 1000).toISOString();
    const file = usage.loadUsage();
    file.skills["old-skill"].created_at = staleAt;
    file.skills["old-skill"].last_viewed_at = staleAt;
    writeFileSync(
      join(home, "skills", ".usage.json"),
      JSON.stringify(file, null, 2),
      "utf8"
    );

    const curator = new CuratorService(configStore, usage, store);
    const result = curator.runReview({ dryRun: false });

    expect(result.archivedCount).toBe(1);
    expect(store.listSkills().some((s) => s.name === "old-skill")).toBe(false);
    expect(usage.listArchived()).toContain("old-skill");
  });

  it("does not archive pinned skills", () => {
    const usage = new SkillUsageService();
    const store = new SkillStoreService(usage);
    const configStore = new CuratorConfigStoreService();
    configStore.saveConfig({
      enabled: true,
      intervalHours: 0,
      minIdleHours: 0,
      staleAfterDays: 1,
      archiveAfterDays: 2,
    });

    store.createSkill({
      name: "pinned-skill",
      description: "Pinned workflow.",
      content: "## Procedure\nPinned.",
    });
    usage.setPinned("pinned-skill", true);

    const staleAt = new Date(Date.now() - 10 * 86400 * 1000).toISOString();
    const file = usage.loadUsage();
    file.skills["pinned-skill"].created_at = staleAt;
    writeFileSync(
      join(home, "skills", ".usage.json"),
      JSON.stringify(file, null, 2),
      "utf8"
    );

    const curator = new CuratorService(configStore, usage, store);
    const result = curator.runReview({ dryRun: false });

    expect(result.archivedCount).toBe(0);
    expect(store.listSkills().some((s) => s.name === "pinned-skill")).toBe(true);
  });
});
