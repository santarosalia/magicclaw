import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SkillStoreService } from "./skill-store.service.js";
import { SkillUsageService } from "./skill-usage.service.js";

describe("SkillStoreService", () => {
  let home: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "magicclaw-skill-"));
    prevHome = process.env.MAGICCLAW_HOME;
    process.env.MAGICCLAW_HOME = home;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.MAGICCLAW_HOME;
    else process.env.MAGICCLAW_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  });

  it("creates, lists, reads, patches, and deletes a skill", () => {
    const usage = new SkillUsageService();
    const store = new SkillStoreService(usage);
    const created = store.createSkill({
      name: "deploy-api",
      description: "Deploy the API to staging.",
      content: "## Procedure\n1. Run tests.\n2. Deploy.",
      category: "devops",
    });
    expect(created.success).toBe(true);

    const listed = store.listSkills();
    expect(listed.some((s) => s.name === "deploy-api")).toBe(true);

    const read = store.readSkill("deploy-api");
    expect(read.success).toBe(true);
    expect(read.content).toContain("Run tests");

    const patched = store.patchSkill(
      "deploy-api",
      "Run tests.",
      "Run full test suite."
    );
    expect(patched.success).toBe(true);
    expect(store.readSkill("deploy-api").content).toContain("full test suite");

    const deleted = store.deleteSkill("deploy-api");
    expect(deleted.success).toBe(true);
    expect(store.listSkills()).toHaveLength(0);
    expect(usage.getRecord("deploy-api")).toBeNull();
  });
});
