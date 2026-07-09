import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** Expand ~, %USERPROFILE%, and return an absolute path. */
export function expandUserPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;

  if (trimmed === "~") {
    return homedir();
  }

  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return join(homedir(), trimmed.slice(2).replace(/^[/\\]+/, ""));
  }

  const userProfile = process.env.USERPROFILE?.trim();
  if (userProfile && /^%USERPROFILE%/i.test(trimmed)) {
    return join(
      userProfile,
      trimmed.replace(/^%USERPROFILE%/i, "").replace(/^[/\\]+/, "")
    );
  }

  return trimmed;
}

export function getMagicClawHome(): string {
  const fromEnv = process.env.MAGICCLAW_HOME?.trim();
  const home = fromEnv
    ? expandUserPath(fromEnv)
    : join(homedir(), ".magicclaw");
  return resolve(home);
}

export function getMemoriesDir(userId: string): string {
  return join(getMagicClawHome(), "memories", sanitizePathSegment(userId));
}

function sanitizePathSegment(segment: string): string {
  return segment.replace(/[^a-zA-Z0-9._:@-]/g, "_");
}
