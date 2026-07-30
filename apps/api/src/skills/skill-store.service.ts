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
import { parseSkillFrontmatter } from "./parse-skill-frontmatter.js";
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
  constructor(@Optional() private readonly usage?: SkillUsageService) {}

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
    return `## INSTALLED SKILLS\nUse skill_manage(action="read", name="...") to load SKILL.md before matching work. If SKILL.md links to other files, read them with path="relative/file" (or action="files" to list).\n${lines.join(
      "\n"
    )}`;
  }

  getSkillDir(name: string): string | null {
    return this.findSkillDir(name);
  }

  readSkill(
    name: string,
    relativePath?: string
  ): {
    success: boolean;
    content?: string;
    path?: string;
    files?: string[];
    error?: string;
  } {
    const skillDir = this.findSkillDir(name);
    if (!skillDir) {
      return { success: false, error: `Skill '${name}' not found.` };
    }

    const targetRel = (relativePath?.trim() || "SKILL.md").replace(/\\/g, "/");
    const resolved = this.resolveSkillFile(skillDir, targetRel);
    if (!resolved.ok) {
      return { success: false, error: resolved.error };
    }
    if (!existsSync(resolved.absPath) || !statSync(resolved.absPath).isFile()) {
      return {
        success: false,
        error: `File '${resolved.relPath}' not found in skill '${name}'.`,
      };
    }

    const content = readFileSync(resolved.absPath, "utf8");
    this.usage?.bumpView(name);
    return {
      success: true,
      content,
      path: resolved.relPath,
      files: this.collectSkillFiles(skillDir),
    };
  }

  listSkillFiles(name: string): {
    success: boolean;
    files?: string[];
    error?: string;
  } {
    const skillDir = this.findSkillDir(name);
    if (!skillDir) {
      return { success: false, error: `Skill '${name}' not found.` };
    }
    return { success: true, files: this.collectSkillFiles(skillDir) };
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
        error:
          "Hub-installed skills must be removed with skill_manage uninstall.",
      };
    }
    const skillDir = this.findSkillDir(name);
    if (!skillDir) {
      return { success: false, error: `Skill '${name}' not found.` };
    }
    if (!this.isInsideSkillsRoot(skillDir)) {
      return {
        success: false,
        error: "Refusing to delete path outside skills root.",
      };
    }
    rmSync(skillDir, { recursive: true, force: true });
    this.usage?.forget(name);
    return { success: true };
  }

  private walkSkills(root: string, dir: string, out: SkillSummary[]): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    const skillPath = join(dir, "SKILL.md");
    if (existsSync(skillPath) && statSync(skillPath).isFile()) {
      const meta = parseSkillFrontmatter(readFileSync(skillPath, "utf8"));
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
        const meta = parseSkillFrontmatter(
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

  private isInsideDir(rootDir: string, candidate: string): boolean {
    const root = resolve(rootDir);
    const resolved = resolve(candidate);
    return resolved === root || resolved.startsWith(`${root}/`);
  }

  private resolveSkillFile(
    skillDir: string,
    relativePath: string
  ):
    | { ok: true; absPath: string; relPath: string }
    | { ok: false; error: string } {
    const trimmed = relativePath.trim();
    if (!trimmed || trimmed.startsWith("/") || /^[A-Za-z]:[\\/]/.test(trimmed)) {
      return {
        ok: false,
        error: "Invalid path: use a relative path inside the skill directory.",
      };
    }
    if (trimmed.split("/").some((seg) => seg === "..")) {
      return {
        ok: false,
        error: "Refusing path that escapes the skill directory.",
      };
    }

    const absPath = resolve(skillDir, trimmed);
    if (!this.isInsideDir(skillDir, absPath)) {
      return {
        ok: false,
        error: "Refusing path that escapes the skill directory.",
      };
    }

    return {
      ok: true,
      absPath,
      relPath: relative(skillDir, absPath).replace(/\\/g, "/"),
    };
  }

  private collectSkillFiles(skillDir: string): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.startsWith(".")) continue;
        const full = join(dir, entry);
        try {
          const st = statSync(full);
          if (st.isDirectory()) {
            walk(full);
          } else if (st.isFile()) {
            out.push(relative(skillDir, full).replace(/\\/g, "/"));
          }
        } catch {
          // skip unreadable
        }
      }
    };
    walk(skillDir);
    return out.sort((a, b) => a.localeCompare(b));
  }
}
