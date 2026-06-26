import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { Injectable } from "@nestjs/common";
import { getMagicClawHome } from "../common/magicclaw-home.js";

export interface HubLockEntry {
  source: string;
  identifier: string;
  install_path: string;
  installed_at: string;
  updated_at: string;
}

export interface HubLockFile {
  version: 1;
  installed: Record<string, HubLockEntry>;
}

export interface HubInstallResult {
  success: boolean;
  name?: string;
  path?: string;
  error?: string;
}

type GithubContentsItem = {
  name: string;
  path: string;
  type: "file" | "dir";
  download_url: string | null;
  content?: string;
};

@Injectable()
export class SkillsHubService {
  private readonly maxFiles = 40;
  private readonly maxTotalBytes = 2 * 1024 * 1024;

  private skillsRoot(): string {
    return join(getMagicClawHome(), "skills");
  }

  private hubDir(): string {
    return join(this.skillsRoot(), ".hub");
  }

  private quarantineDir(): string {
    return join(this.hubDir(), "quarantine");
  }

  private lockPath(): string {
    return join(this.hubDir(), "lock.json");
  }

  loadLock(): HubLockFile {
    if (!existsSync(this.lockPath())) {
      return { version: 1, installed: {} };
    }
    try {
      return JSON.parse(readFileSync(this.lockPath(), "utf8")) as HubLockFile;
    } catch {
      return { version: 1, installed: {} };
    }
  }

  private saveLock(lock: HubLockFile): void {
    mkdirSync(this.hubDir(), { recursive: true });
    const tmp = `${this.lockPath()}.tmp`;
    writeFileSync(tmp, JSON.stringify(lock, null, 2), "utf8");
    renameSync(tmp, this.lockPath());
  }

  listInstalled(): Array<{ name: string } & HubLockEntry> {
    const lock = this.loadLock();
    return Object.entries(lock.installed).map(([name, entry]) => ({
      name,
      ...entry,
    }));
  }

  parseGithubIdentifier(raw: string): {
    owner: string;
    repo: string;
    path: string;
    branch: string;
  } | null {
    const trimmed = raw.trim().replace(/^github:/i, "");

    const urlMatch = trimmed.match(
      /^https?:\/\/github\.com\/([^/]+)\/([^/]+)(?:\/tree\/([^/]+)\/(.+))?$/i
    );
    if (urlMatch) {
      return {
        owner: urlMatch[1],
        repo: urlMatch[2].replace(/\.git$/, ""),
        branch: urlMatch[3] ?? "main",
        path: (urlMatch[4] ?? "").replace(/\/$/, ""),
      };
    }

    const parts = trimmed.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    return {
      owner: parts[0],
      repo: parts[1].replace(/\.git$/, ""),
      branch: "main",
      path: parts.slice(2).join("/"),
    };
  }

  async install(
    identifier: string,
    opts?: { force?: boolean; category?: string }
  ): Promise<HubInstallResult> {
    const parsed = this.parseGithubIdentifier(identifier);
    if (!parsed) {
      return {
        success: false,
        error:
          "Invalid identifier. Use owner/repo, owner/repo/path, or a GitHub tree URL.",
      };
    }

    const download = await this.downloadSkillTree(parsed);
    if (!download.ok) {
      return { success: false, error: download.error };
    }

    const skillMdKey = Object.keys(download.data).find((k) =>
      k.endsWith("SKILL.md")
    );
    if (!skillMdKey) {
      return { success: false, error: "No SKILL.md found at the requested path." };
    }

    const name = this.parseSkillName(download.data[skillMdKey]);
    if (!name) {
      return { success: false, error: "SKILL.md is missing name in frontmatter." };
    }

    const lock = this.loadLock();
    if (lock.installed[name] && !opts?.force) {
      return {
        success: false,
        error: `Skill '${name}' already installed. Use force to reinstall.`,
      };
    }

    const category = (opts?.category ?? "hub").replace(/[^a-zA-Z0-9._-]/g, "_");
    const destRoot = join(this.skillsRoot(), category, name);
    if (existsSync(destRoot) && !opts?.force) {
      return { success: false, error: `Directory already exists: ${destRoot}` };
    }

    mkdirSync(this.quarantineDir(), { recursive: true });
    const quarantine = join(this.quarantineDir(), `${name}-${Date.now()}`);
    mkdirSync(quarantine, { recursive: true });

    const basePath = parsed.path ? `${parsed.path}/` : "";
    for (const [relPath, content] of Object.entries(download.data)) {
      const localRel = basePath && relPath.startsWith(basePath)
        ? relPath.slice(basePath.length)
        : relPath === "SKILL.md" || !basePath
          ? relPath
          : null;
      if (!localRel || localRel.includes("..")) continue;
      const outPath = join(quarantine, localRel);
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, content, "utf8");
    }

    if (existsSync(destRoot)) {
      rmSync(destRoot, { recursive: true, force: true });
    }
    mkdirSync(join(this.skillsRoot(), category), { recursive: true });
    renameSync(quarantine, destRoot);

    const installPath = `${category}/${name}`;
    const now = new Date().toISOString();
    lock.installed[name] = {
      source: "github",
      identifier: identifier.trim().replace(/^github:/i, ""),
      install_path: installPath,
      installed_at: lock.installed[name]?.installed_at ?? now,
      updated_at: now,
    };
    this.saveLock(lock);

    return { success: true, name, path: installPath };
  }

  uninstall(name: string): { success: boolean; error?: string } {
    const lock = this.loadLock();
    const entry = lock.installed[name];
    if (!entry) {
      return { success: false, error: `Hub skill '${name}' not found.` };
    }

    const target = join(this.skillsRoot(), entry.install_path);
    const resolvedSkillsRoot = join(this.skillsRoot());
    if (!target.startsWith(resolvedSkillsRoot)) {
      return { success: false, error: "Refusing unsafe uninstall path." };
    }

    if (existsSync(target)) {
      rmSync(target, { recursive: true, force: true });
    }
    delete lock.installed[name];
    this.saveLock(lock);
    return { success: true };
  }

  private parseSkillName(skillMd: string): string {
    const match = skillMd.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return "";
    for (const line of match[1].split("\n")) {
      const [key, ...rest] = line.split(":");
      if (key.trim() === "name") return rest.join(":").trim();
    }
    return "";
  }

  private async downloadSkillTree(parsed: {
    owner: string;
    repo: string;
    path: string;
    branch: string;
  }): Promise<
    | { ok: true; data: Record<string, string> }
    | { ok: false; error: string }
  > {
    for (const branch of [parsed.branch, "main", "master"]) {
      const data: Record<string, string> = {};
      const err = await this.walkGithubDir(
        parsed.owner,
        parsed.repo,
        parsed.path,
        branch,
        data
      );
      if (!err && Object.keys(data).length > 0) {
        return { ok: true, data };
      }
      if (err && !err.includes("404")) {
        return { ok: false, error: err };
      }
    }
    return { ok: false, error: "Could not fetch skill from GitHub." };
  }

  private async walkGithubDir(
    owner: string,
    repo: string,
    path: string,
    branch: string,
    out: Record<string, string>
  ): Promise<string | null> {
    if (Object.keys(out).length >= this.maxFiles) {
      return "Too many files in skill directory.";
    }

    const apiPath = path
      ? `repos/${owner}/${repo}/contents/${path}?ref=${branch}`
      : `repos/${owner}/${repo}/contents?ref=${branch}`;

    const response = await this.githubGet(apiPath);
    if (!response.ok) return response.error;

    const items = Array.isArray(response.data)
      ? (response.data as GithubContentsItem[])
      : [response.data as GithubContentsItem];

    for (const item of items) {
      if (item.type === "dir") {
        const err = await this.walkGithubDir(
          owner,
          repo,
          item.path,
          branch,
          out
        );
        if (err) return err;
        continue;
      }

      if (item.type !== "file") continue;

      let text = "";
      if (item.download_url) {
        const fileRes = await fetch(item.download_url);
        if (!fileRes.ok) continue;
        text = await fileRes.text();
      } else if (item.content) {
        text = Buffer.from(item.content, "base64").toString("utf8");
      }

      const size = Buffer.byteLength(text, "utf8");
      const total = Object.values(out).reduce(
        (sum, v) => sum + Buffer.byteLength(v, "utf8"),
        0
      );
      if (total + size > this.maxTotalBytes) {
        return "Skill exceeds size limit.";
      }

      out[item.path] = text;
    }

    return null;
  }

  private async githubGet(
    apiPath: string
  ): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
    const token = process.env.GITHUB_TOKEN?.trim();
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "magicclaw-skills-hub",
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    try {
      const res = await fetch(`https://api.github.com/${apiPath}`, { headers });
      if (!res.ok) {
        return { ok: false, error: `GitHub API ${res.status}` };
      }
      return { ok: true, data: await res.json() };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
