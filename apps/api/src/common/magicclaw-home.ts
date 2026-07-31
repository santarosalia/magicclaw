import { existsSync, mkdirSync, renameSync } from "node:fs";
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

/** JSON config files live under MAGICCLAW_HOME/config/. */
export function getConfigDir(): string {
  return join(getMagicClawHome(), "config");
}

/**
 * Resolve a config file path under config/.
 * If a legacy file still exists at the home root, migrate it once.
 */
export function resolveConfigFilePath(filename: string): string {
  const configDir = getConfigDir();
  const configPath = join(configDir, filename);
  if (existsSync(configPath)) return configPath;

  const legacyPath = join(getMagicClawHome(), filename);
  if (existsSync(legacyPath)) {
    mkdirSync(configDir, { recursive: true });
    renameSync(legacyPath, configPath);
  }
  return configPath;
}

export function getMemoriesDir(userId: string): string {
  return join(getMagicClawHome(), "memories", sanitizePathSegment(userId));
}

/** Filesystem-safe directory name for scoped ids like web:uuid or telegram:123. */
export function sanitizePathSegment(segment: string): string {
  return segment
    .replace(/:/g, "_")
    .replace(/[^a-zA-Z0-9._@-]/g, "_")
    .replace(/[. ]+$/g, "");
}
