import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, normalize, resolve } from "node:path";
import {
  expandUserPath,
  getWorkspaceRoot,
} from "../../common/magicclaw-home.js";

export { getWorkspaceRoot };

export function ensureWorkspaceRoot(root = getWorkspaceRoot()): string {
  mkdirSync(root, { recursive: true });
  return root;
}

/**
 * Resolve a user-supplied path against the workspace.
 * Absolute / ~/ paths are expanded; relative paths join workspaceRoot.
 */
export function resolveToolPath(
  path: string,
  workspaceRoot: string = getWorkspaceRoot()
): string {
  const trimmed = path.trim();
  if (!trimmed) {
    throw new Error("path must be a non-empty string");
  }
  if (trimmed === "~" || trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return resolve(expandUserPath(trimmed));
  }
  if (isAbsolute(trimmed) || /^[A-Za-z]:[\\/]/.test(trimmed)) {
    return resolve(trimmed);
  }
  return resolve(workspaceRoot, trimmed);
}

export function isPathInside(child: string, parent: string): boolean {
  const resolvedChild = normalize(resolve(child));
  const resolvedParent = normalize(resolve(parent));
  if (resolvedChild === resolvedParent) return true;
  const prefix = resolvedParent.endsWith("/")
    ? resolvedParent
    : `${resolvedParent}/`;
  // Windows: compare case-insensitively for containment checks.
  const childCmp =
    process.platform === "win32"
      ? resolvedChild.toLowerCase()
      : resolvedChild;
  const prefixCmp =
    process.platform === "win32" ? prefix.toLowerCase() : prefix;
  return childCmp.startsWith(prefixCmp);
}

export function homeDir(): string {
  return homedir();
}
