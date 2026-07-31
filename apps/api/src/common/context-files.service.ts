import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Injectable } from "@nestjs/common";
import { getMagicClawHome, getWorkspaceRoot } from "./magicclaw-home.js";

const CONTEXT_FILE_NAMES = ["AGENTS.md", "SOUL.md", "CLAUDE.md"] as const;
const MAX_FILE_BYTES = 32 * 1024;

@Injectable()
export class ContextFilesService {
  getWorkspaceRoot(): string {
    return getWorkspaceRoot();
  }

  buildContextFilesBlock(): string {
    const blocks: string[] = [];

    for (const name of CONTEXT_FILE_NAMES) {
      const workspacePath = join(this.getWorkspaceRoot(), name);
      const globalPath = join(getMagicClawHome(), name);
      const content = this.readIfExists(workspacePath) ?? this.readIfExists(globalPath);
      if (content) {
        blocks.push(`### ${name}\n${content}`);
      }
    }

    if (blocks.length === 0) return "";
    return `## PROJECT CONTEXT FILES\n${blocks.join("\n\n")}`;
  }

  private readIfExists(path: string): string | null {
    try {
      if (!existsSync(path) || !statSync(path).isFile()) return null;
      const raw = readFileSync(path, "utf8");
      if (Buffer.byteLength(raw, "utf8") > MAX_FILE_BYTES) {
        return `${raw.slice(0, MAX_FILE_BYTES)}\n\n[truncated — file exceeds ${MAX_FILE_BYTES} bytes]`;
      }
      return raw.trim() || null;
    } catch {
      return null;
    }
  }
}
