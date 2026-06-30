import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { Injectable, Optional } from "@nestjs/common";
import { getMagicClawHome } from "../common/magicclaw-home.js";
import type { SkillUsageService } from "./skill-usage.service.js";

export interface SkillSummary {
  name: string;
  description: string;
  path: string;
  category: string;
}

const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 200;
const MAX_SKILL_BODY_BYTES = 64 * 1024;

@Injectable()
export class SkillStoreService {
  constructor(
    @Optional() private readonly usage?: SkillUsageService
  ) {}

  private skillsRoot(): string {
    return join(getMagicClawHome(), "skills");
  }

  listSkills(): SkillSummary[] {
    const root = this.skillsRoot();
    if (!existsSync(root)) return [];

    const results: SkillSummary[] = [];
    this.walkSkills(root, root, results);
    return results.sort((a, b) => a.name.localeCompare(b.name));
  }

  buildSkillsIndexBlock(): string {
    const skills = this.listSkills();
    if (skills.length === 0) return "";

    const lines = skills.map(
      (s) => `- ${s.name} (${s.category}): ${s.description || "no description"}`
    );
    return `## INSTALLED SKILLS\nUse skill_manage(action="read", name="...") to load full instructions before matching work.\n${lines.join("\n")}`;
  }

  getSkillDir(name: string): string | null {
    return this.findSkillDir(name);
  }

  readSkill(name: string): { success: boolean; content?: string; error?: string } {
    const skillDir = this.findSkillDir(name);
    if (!skillDir) {
      return { success: false, error: `Skill '${name}' not found.` };
    }
    const skillPath = join(skillDir, "SKILL.md");
    const content = readFileSync(skillPath, "utf8");
    this.usage?.bumpView(name);
    return {
      success: true,
      content,
    };
  }

  createSkill(input: {
    name: string;
    description: string;
    content: string;
    category?: string;
  }): { success: boolean; path?: string; error?: string } {
    const nameErr = this.validateName(input.name);
    if (nameErr) return { success: false, error: nameErr };

    const category = this.sanitizeSegment(input.category?.trim() || "user");
    const skillDir = join(this.skillsRoot(), category, input.name.trim());
    if (existsSync(skillDir)) {
      return { success: false, error: `Skill '${input.name}' already exists.` };
    }

    const body = this.buildSkillMarkdown(
      input.name.trim(),
      input.description.trim(),
      input.content
    );
    if (Buffer.byteLength(body, "utf8") > MAX_SKILL_BODY_BYTES) {
      return { success: false, error: "Skill body too large." };
    }

    mkdirSync(skillDir, { recursive: true });
    for (const sub of ["references", "templates", "scripts"]) {
      mkdirSync(join(skillDir, sub), { recursive: true });
    }
    writeFileSync(join(skillDir, "SKILL.md"), body, "utf8");
    this.usage?.markAgentCreated(input.name.trim());

    return {
      success: true,
      path: relative(getMagicClawHome(), skillDir),
    };
  }

  editSkill(
    name: string,
    content: string
  ): { success: boolean; error?: string } {
    const skillDir = this.findSkillDir(name);
    if (!skillDir) {
      return { success: false, error: `Skill '${name}' not found.` };
    }
    if (Buffer.byteLength(content, "utf8") > MAX_SKILL_BODY_BYTES) {
      return { success: false, error: "Skill body too large." };
    }
    writeFileSync(join(skillDir, "SKILL.md"), content, "utf8");
    this.usage?.bumpPatch(name);
    return { success: true };
  }

  patchSkill(
    name: string,
    oldText: string,
    newText: string
  ): { success: boolean; error?: string } {
    const skillDir = this.findSkillDir(name);
    if (!skillDir) {
      return { success: false, error: `Skill '${name}' not found.` };
    }
    const skillPath = join(skillDir, "SKILL.md");
    const current = readFileSync(skillPath, "utf8");
    if (!current.includes(oldText)) {
      return { success: false, error: "old_text not found in SKILL.md." };
    }
    writeFileSync(skillPath, current.replace(oldText, newText), "utf8");
    this.usage?.bumpPatch(name);
    return { success: true };
  }

  deleteSkill(name: string): { success: boolean; error?: string } {
    if (this.usage?.isPinned(name)) {
      return { success: false, error: "Pinned skills cannot be deleted." };
    }
    if (this.usage?.isHubInstalled(name)) {
      return {
        success: false,
        error: "Hub-installed skills must be removed with skill_manage uninstall.",
      };
    }
    const skillDir = this.findSkillDir(name);
    if (!skillDir) {
      return { success: false, error: `Skill '${name}' not found.` };
    }
    if (!this.isInsideSkillsRoot(skillDir)) {
      return { success: false, error: "Refusing to delete path outside skills root." };
    }
    rmSync(skillDir, { recursive: true, force: true });
    this.usage?.forget(name);
    return { success: true };
  }

  private walkSkills(
    root: string,
    dir: string,
    out: SkillSummary[]
  ): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    const skillPath = join(dir, "SKILL.md");
    if (existsSync(skillPath) && statSync(skillPath).isFile()) {
      const meta = this.parseSkillFrontmatter(readFileSync(skillPath, "utf8"));
      const rel = relative(root, dir);
      const category = rel.includes("/") ? rel.split("/")[0] : "user";
      out.push({
        name: meta.name || dir.split("/").pop() || "unknown",
        description: meta.description,
        path: rel,
        category,
      });
      return;
    }

    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      const full = join(dir, entry);
      try {
        if (statSync(full).isDirectory()) {
          this.walkSkills(root, full, out);
        }
      } catch {
        // skip unreadable
      }
    }
  }

  private parseSkillFrontmatter(raw: string): {
    name: string;
    description: string;
  } {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return { name: "", description: "" };

    let name = "";
    let description = "";
    for (const line of match[1].split("\n")) {
      const [key, ...rest] = line.split(":");
      const value = rest.join(":").trim();
      if (key.trim() === "name") name = value;
      if (key.trim() === "description") description = value;
    }
    return { name, description };
  }

  private buildSkillMarkdown(
    name: string,
    description: string,
    body: string
  ): string {
    const desc =
      description.length > MAX_DESCRIPTION_LENGTH
        ? `${description.slice(0, MAX_DESCRIPTION_LENGTH - 1)}.`
        : description.endsWith(".")
          ? description
          : `${description}.`;

    const trimmedBody = body.trim();
    if (trimmedBody.startsWith("---")) return trimmedBody;

    return `---
name: ${name}
description: ${desc}
---

# ${name} Skill

${trimmedBody}
`;
  }

  private findSkillDir(name: string): string | null {
    const root = this.skillsRoot();
    if (!existsSync(root)) return null;

    const target = name.trim().toLowerCase();
    const found: string[] = [];

    const scan = (dir: string) => {
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        return;
      }

      if (existsSync(join(dir, "SKILL.md"))) {
        const meta = this.parseSkillFrontmatter(
          readFileSync(join(dir, "SKILL.md"), "utf8")
        );
        const dirName = dir.split("/").pop() ?? "";
        if (
          meta.name.toLowerCase() === target ||
          dirName.toLowerCase() === target
        ) {
          found.push(dir);
        }
        return;
      }

      for (const entry of entries) {
        if (entry.startsWith(".")) continue;
        const full = join(dir, entry);
        try {
          if (statSync(full).isDirectory()) scan(full);
        } catch {
          // skip
        }
      }
    };

    scan(root);
    return found[0] ?? null;
  }

  private validateName(name: string): string | null {
    const trimmed = name.trim();
    if (!trimmed) return "Skill name is required.";
    if (trimmed.length > MAX_NAME_LENGTH) {
      return `Skill name must be ≤ ${MAX_NAME_LENGTH} chars.`;
    }
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(trimmed)) {
      return "Skill name must be alphanumeric with _ or -.";
    }
    return null;
  }

  private sanitizeSegment(segment: string): string {
    return segment.replace(/[^a-zA-Z0-9._-]/g, "_");
  }

  private isInsideSkillsRoot(skillDir: string): boolean {
    const root = resolve(this.skillsRoot());
    const resolved = resolve(skillDir);
    return resolved === root || resolved.startsWith(`${root}/`);
  }
}
