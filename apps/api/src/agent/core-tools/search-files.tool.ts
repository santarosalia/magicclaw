import { execFile } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { ensureWorkspaceRoot, resolveToolPath } from "./workspace.js";

const execFileAsync = promisify(execFile);

export function createSearchFilesTool(
  workspaceRoot: string
): DynamicStructuredTool {
  const root = ensureWorkspaceRoot(workspaceRoot);

  return new DynamicStructuredTool({
    name: "search_files",
    description:
      "Search file contents or find files by name. Use this instead of grep/rg/find/ls in terminal. " +
      "target='content': regex search inside files. target='files': glob/name search (also replaces ls).",
    schema: z.object({
      pattern: z
        .string()
        .describe(
          "Regex for content search, or glob/substring for file search (e.g. '*.ts')"
        ),
      target: z
        .enum(["content", "files"])
        .optional()
        .default("content")
        .describe("'content' searches inside files; 'files' finds by name"),
      path: z
        .string()
        .optional()
        .default(".")
        .describe("Directory or file to search (default: workspace)"),
      file_glob: z
        .string()
        .optional()
        .describe("Filter files in content mode (e.g. '*.ts')"),
      limit: z.number().int().positive().optional().default(50),
      offset: z.number().int().min(0).optional().default(0),
      output_mode: z
        .enum(["content", "files_only", "count"])
        .optional()
        .default("content"),
      context: z
        .number()
        .int()
        .min(0)
        .optional()
        .default(0)
        .describe("Context lines around matches (content mode)"),
    }),
    func: async ({
      pattern,
      target,
      path,
      file_glob,
      limit,
      offset,
      output_mode,
      context,
    }) => {
      const searchRoot = resolveToolPath(path ?? ".", root);
      if (!existsSync(searchRoot)) {
        return JSON.stringify({
          success: false,
          error: `Path not found: ${searchRoot}`,
        });
      }

      const max = limit ?? 50;
      const skip = offset ?? 0;

      if (target === "files") {
        const files = walkFiles(searchRoot)
          .map((f) => relative(searchRoot, f) || f)
          .filter((f) => matchGlobOrSubstring(f, pattern))
          .sort((a, b) => a.localeCompare(b));
        const page = files.slice(skip, skip + max);
        return JSON.stringify({
          success: true,
          target: "files",
          total: files.length,
          results: page,
        });
      }

      try {
        const args = ["--line-number", "--color", "never", "-e", pattern];
        if (file_glob) args.push("--glob", file_glob);
        if ((context ?? 0) > 0) {
          args.push("-C", String(context));
        }
        if (output_mode === "files_only") args.push("-l");
        if (output_mode === "count") args.push("-c");
        args.push(searchRoot);

        const { stdout } = await execFileAsync("rg", args, {
          maxBuffer: 5 * 1024 * 1024,
          timeout: 30_000,
        }).catch((err: { stdout?: string; code?: number }) => {
          // rg exits 1 when no matches
          if (err.code === 1) return { stdout: err.stdout ?? "" };
          throw err;
        });

        const lines = (stdout || "")
          .split("\n")
          .filter(Boolean)
          .slice(skip, skip + max);

        return JSON.stringify({
          success: true,
          target: "content",
          output_mode: output_mode ?? "content",
          results: lines,
        });
      } catch {
        // Fallback without ripgrep: naive scan
        const files = walkFiles(searchRoot).filter((f) =>
          file_glob ? matchGlobOrSubstring(f, file_glob) : true
        );
        const re = new RegExp(pattern);
        const hits: string[] = [];
        for (const file of files) {
          try {
            const text = readFileSync(file, "utf8");
            const fileLines = text.split("\n");
            for (let i = 0; i < fileLines.length; i++) {
              if (!re.test(fileLines[i]!)) continue;
              if (output_mode === "files_only") {
                hits.push(relative(searchRoot, file));
                break;
              }
              hits.push(`${relative(searchRoot, file)}:${i + 1}:${fileLines[i]}`);
              if (hits.length >= skip + max) break;
            }
          } catch {
            // skip unreadable
          }
          if (hits.length >= skip + max) break;
        }
        return JSON.stringify({
          success: true,
          target: "content",
          output_mode: output_mode ?? "content",
          results: hits.slice(skip, skip + max),
          note: "ripgrep unavailable; used fallback scanner",
        });
      }
    },
  });
}

function walkFiles(root: string): string[] {
  const out: string[] = [];
  const skip = new Set([
    "node_modules",
    ".git",
    "dist",
    ".next",
    "coverage",
    "__pycache__",
  ]);

  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (skip.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(full);
    }
  };

  try {
    if (statSync(root).isFile()) return [root];
  } catch {
    return [];
  }
  walk(root);
  return out;
}

function matchGlobOrSubstring(path: string, pattern: string): boolean {
  if (!pattern.includes("*") && !pattern.includes("?")) {
    return path.toLowerCase().includes(pattern.toLowerCase());
  }
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i").test(path.split(/[/\\]/).pop() ?? path);
}
