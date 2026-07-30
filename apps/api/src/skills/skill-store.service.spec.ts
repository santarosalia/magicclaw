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

  it("reads companion files by relative path and lists skill files", () => {
    const skillDir = join(home, "skills", "user", "db-query");
    mkdirSync(join(skillDir, "references"), { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---
name: db-query
description: Query the database.
---

See [catalog.md](catalog.md) and [references/notes.md](references/notes.md).
`,
      "utf8"
    );
    writeFileSync(join(skillDir, "catalog.md"), "# Catalog\nsoft-delete rules\n", "utf8");
    writeFileSync(
      join(skillDir, "references", "notes.md"),
      "# Notes\njoin parents\n",
      "utf8"
    );

    const store = new SkillStoreService(new SkillUsageService());

    const root = store.readSkill("db-query");
    expect(root.success).toBe(true);
    expect(root.path).toBe("SKILL.md");
    expect(root.content).toContain("catalog.md");
    expect(root.files).toEqual(
      expect.arrayContaining(["SKILL.md", "catalog.md", "references/notes.md"])
    );

    const catalog = store.readSkill("db-query", "catalog.md");
    expect(catalog.success).toBe(true);
    expect(catalog.path).toBe("catalog.md");
    expect(catalog.content).toContain("soft-delete rules");
    expect(catalog.files).toEqual(
      expect.arrayContaining(["SKILL.md", "catalog.md", "references/notes.md"])
    );

    const nested = store.readSkill("db-query", "references/notes.md");
    expect(nested.success).toBe(true);
    expect(nested.content).toContain("join parents");

    const listed = store.listSkillFiles("db-query");
    expect(listed.success).toBe(true);
    expect(listed.files).toEqual(
      expect.arrayContaining(["SKILL.md", "catalog.md", "references/notes.md"])
    );
  });

  it("rejects path traversal and missing companion files", () => {
    const skillDir = join(home, "skills", "safe");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---
name: safe
description: Safe skill.
---

# Safe
`,
      "utf8"
    );
    writeFileSync(join(home, "outside.txt"), "secret", "utf8");

    const store = new SkillStoreService(new SkillUsageService());

    const escape = store.readSkill("safe", "../outside.txt");
    expect(escape.success).toBe(false);
    expect(escape.error).toMatch(/outside|refusing|invalid/i);

    const missing = store.readSkill("safe", "catalog.md");
    expect(missing.success).toBe(false);
    expect(missing.error).toMatch(/not found/i);
  });
});
