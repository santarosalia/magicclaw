import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

  it("parses multiline YAML description block scalars", () => {
    const skillDir = join(home, "skills", "deploy");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---
name: deploy-api
description: |
  Deploy the API to staging.
  Use when shipping a release.
---

# Deploy
`,
      "utf8"
    );

    const store = new SkillStoreService(new SkillUsageService());
    const listed = store.listSkills();
    expect(listed).toHaveLength(1);
    expect(listed[0].name).toBe("deploy-api");
    expect(listed[0].description).toContain("Deploy the API to staging.");
    expect(listed[0].description).toContain("Use when shipping a release.");
  });

  it("parses folded YAML description scalars", () => {
    const skillDir = join(home, "skills", "review");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---
name: code-review
description: >
  Review pull requests for correctness
  and security issues.
---

# Review
`,
      "utf8"
    );

    const store = new SkillStoreService(new SkillUsageService());
    const listed = store.listSkills();
    expect(listed).toHaveLength(1);
    expect(listed[0].description).toMatch(
      /Review pull requests for correctness\s+and security issues\./
    );
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
