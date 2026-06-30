import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Injectable, Logger } from "@nestjs/common";
import { getMagicClawHome } from "../common/magicclaw-home.js";
import type {
  SkillUsageFile,
  SkillUsageRecord,
  SkillUsageState,
} from "./skill-usage.types.js";

function nowIso(): string {
  return new Date().toISOString();
}

function parseIso(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function latestActivityMs(record: SkillUsageRecord): number | null {
  const candidates = [
    record.last_used_at,
    record.last_viewed_at,
    record.last_patched_at,
  ]
    .map(parseIso)
    .filter((v): v is number => v !== null);
  return candidates.length > 0 ? Math.max(...candidates) : null;
}

@Injectable()
export class SkillUsageService {
  private readonly logger = new Logger(SkillUsageService.name);

  private skillsRoot(): string {
    return join(getMagicClawHome(), "skills");
  }

  private usagePath(): string {
    return join(this.skillsRoot(), ".usage.json");
  }

  private archiveRoot(): string {
    return join(this.skillsRoot(), ".archive");
  }

  private hubLockPath(): string {
    return join(this.skillsRoot(), ".hub", "lock.json");
  }

  loadUsage(): SkillUsageFile {
    const path = this.usagePath();
    if (!existsSync(path)) {
      return { version: 1, skills: {} };
    }
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as SkillUsageFile;
      if (!raw.skills) return { version: 1, skills: {} };
      return raw;
    } catch (error) {
      this.logger.warn(`Failed to read ${path}`);
      return { version: 1, skills: {} };
    }
  }

  private saveUsage(data: SkillUsageFile): void {
    mkdirSync(this.skillsRoot(), { recursive: true });
    const path = this.usagePath();
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
    renameSync(tmp, path);
  }

  private mutate(mutator: (file: SkillUsageFile) => void): void {
    const file = this.loadUsage();
    mutator(file);
    this.saveUsage(file);
  }

  getRecord(name: string): SkillUsageRecord | null {
    return this.loadUsage().skills[name] ?? null;
  }

  markAgentCreated(name: string): void {
    this.mutate((file) => {
      const existing = file.skills[name];
      file.skills[name] = {
        created_by: "agent",
        use_count: existing?.use_count ?? 0,
        view_count: existing?.view_count ?? 0,
        last_used_at: existing?.last_used_at ?? null,
        last_viewed_at: existing?.last_viewed_at ?? null,
        patch_count: existing?.patch_count ?? 0,
        last_patched_at: existing?.last_patched_at ?? null,
        created_at: existing?.created_at ?? nowIso(),
        state: existing?.state ?? "active",
        pinned: existing?.pinned ?? false,
        archived_at: existing?.archived_at ?? null,
      };
    });
  }

  bumpView(name: string): void {
    this.mutate((file) => {
      const rec = file.skills[name];
      if (!rec) return;
      rec.view_count += 1;
      rec.last_viewed_at = nowIso();
    });
  }

  bumpUse(name: string): void {
    this.mutate((file) => {
      const rec = file.skills[name];
      if (!rec) return;
      rec.use_count += 1;
      rec.last_used_at = nowIso();
    });
  }

  bumpPatch(name: string): void {
    this.mutate((file) => {
      const rec = file.skills[name];
      if (!rec) return;
      rec.patch_count += 1;
      rec.last_patched_at = nowIso();
    });
  }

  setPinned(name: string, pinned: boolean): void {
    this.mutate((file) => {
      const rec = file.skills[name];
      if (!rec) return;
      rec.pinned = pinned;
    });
  }

  setState(name: string, state: SkillUsageState): void {
    this.mutate((file) => {
      const rec = file.skills[name];
      if (!rec) return;
      rec.state = state;
    });
  }

  forget(name: string): void {
    this.mutate((file) => {
      delete file.skills[name];
    });
  }

  isHubInstalled(name: string): boolean {
    try {
      if (!existsSync(this.hubLockPath())) return false;
      const lock = JSON.parse(readFileSync(this.hubLockPath(), "utf8")) as {
        installed?: Record<string, unknown>;
      };
      return Boolean(lock.installed?.[name]);
    } catch {
      return false;
    }
  }

  isCuratorManaged(name: string): boolean {
    const rec = this.getRecord(name);
    return rec?.created_by === "agent";
  }

  isPinned(name: string): boolean {
    return Boolean(this.getRecord(name)?.pinned);
  }

  getAgentCreatedReport(): Array<{
    name: string;
    record: SkillUsageRecord;
    lastActivityAt: string | null;
  }> {
    const file = this.loadUsage();
    return Object.entries(file.skills)
      .filter(([, rec]) => rec.created_by === "agent")
      .map(([name, record]) => ({
        name,
        record,
        lastActivityAt: this.formatActivity(record),
      }));
  }

  formatActivity(record: SkillUsageRecord): string | null {
    const ms = latestActivityMs(record);
    if (ms !== null) return new Date(ms).toISOString();
    return record.created_at ?? null;
  }

  archiveSkill(
    name: string,
    skillDir: string
  ): { success: boolean; error?: string } {
    if (this.isHubInstalled(name)) {
      return { success: false, error: "Hub-installed skills cannot be archived." };
    }
    if (this.isPinned(name)) {
      return { success: false, error: "Pinned skills cannot be archived." };
    }
    if (!existsSync(skillDir)) {
      return { success: false, error: "Skill directory not found." };
    }

    mkdirSync(this.archiveRoot(), { recursive: true });
    const dest = join(this.archiveRoot(), name);
    if (existsSync(dest)) {
      return { success: false, error: "Archive destination already exists." };
    }

    try {
      renameSync(skillDir, dest);
      this.mutate((file) => {
        const rec = file.skills[name];
        if (!rec) return;
        rec.state = "archived";
        rec.archived_at = nowIso();
      });
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  restoreSkill(name: string): { success: boolean; path?: string; error?: string } {
    const archived = join(this.archiveRoot(), name);
    if (!existsSync(archived)) {
      return { success: false, error: "Archived skill not found." };
    }

    const category = "user";
    const dest = join(this.skillsRoot(), category, name);
    if (existsSync(dest)) {
      return { success: false, error: "Active skill with same name exists." };
    }

    mkdirSync(join(this.skillsRoot(), category), { recursive: true });
    try {
      renameSync(archived, dest);
      this.mutate((file) => {
        const rec = file.skills[name];
        if (!rec) return;
        rec.state = "active";
        rec.archived_at = null;
      });
      return { success: true, path: dest };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  listArchived(): string[] {
    const root = this.archiveRoot();
    if (!existsSync(root)) return [];
    try {
      return readdirSync(root).filter((e) => !e.startsWith("."));
    } catch {
      return [];
    }
  }
}
