import { homedir } from "node:os";
import { join } from "node:path";

export function getMagicClawHome(): string {
  if (process.env.MAGICCLAW_HOME?.trim()) {
    return process.env.MAGICCLAW_HOME.trim();
  }
  return join(homedir(), ".magicclaw");
}

export function getMemoriesDir(userId: string): string {
  return join(getMagicClawHome(), "memories", sanitizePathSegment(userId));
}

function sanitizePathSegment(segment: string): string {
  return segment.replace(/[^a-zA-Z0-9._:@-]/g, "_");
}
