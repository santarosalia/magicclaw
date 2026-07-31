import { readFileSync, existsSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { ensureWorkspaceRoot, resolveToolPath } from "./workspace.js";

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;
const MAX_CHARS = 100_000;

export function createReadFileTool(workspaceRoot: string): DynamicStructuredTool {
  const root = ensureWorkspaceRoot(workspaceRoot);

  return new DynamicStructuredTool({
    name: "read_file",
    description:
      "Read a text file with line numbers and pagination. Use this instead of cat/head/tail in terminal. " +
      "Output format: 'LINE_NUM|CONTENT'. Use offset and limit for large files. " +
      "Reads exceeding ~100K characters are truncated with next_offset.",
    schema: z.object({
      path: z.string().describe("Path to the file (absolute, relative, or ~/path)"),
      offset: z
        .number()
        .int()
        .min(1)
        .optional()
        .default(1)
        .describe("1-indexed start line (default 1)"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_LIMIT)
        .optional()
        .default(DEFAULT_LIMIT)
        .describe(`Max lines to read (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT})`),
    }),
    func: async ({ path, offset, limit }) => {
      const absolute = resolveToolPath(path, root);
      if (!existsSync(absolute)) {
        const suggestion = suggestSimilar(absolute);
        return JSON.stringify({
          success: false,
          error: `File not found: ${absolute}`,
          ...(suggestion ? { suggestion } : {}),
        });
      }

      let raw: string;
      try {
        raw = readFileSync(absolute, "utf8");
      } catch (err) {
        return JSON.stringify({
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      const lines = raw.split("\n");
      const start = Math.max(1, offset ?? 1);
      const maxLines = Math.min(limit ?? DEFAULT_LIMIT, MAX_LIMIT);
      const slice = lines.slice(start - 1, start - 1 + maxLines);
      let body = slice
        .map((line, i) => `${start + i}|${line}`)
        .join("\n");

      let nextOffset: number | undefined;
      if (Buffer.byteLength(body, "utf8") > MAX_CHARS) {
        let cut = body.length;
        while (
          cut > 0 &&
          Buffer.byteLength(body.slice(0, cut), "utf8") > MAX_CHARS
        ) {
          cut = body.lastIndexOf("\n", cut - 1);
        }
        const kept = body.slice(0, cut);
        const keptLines = kept ? kept.split("\n").length : 0;
        body = `${kept}\n\n[truncated — continue with offset=${start + keptLines}]`;
        nextOffset = start + keptLines;
      } else if (start - 1 + slice.length < lines.length) {
        nextOffset = start + slice.length;
      }

      return JSON.stringify({
        success: true,
        path: absolute,
        offset: start,
        lines_returned: slice.length,
        total_lines: lines.length,
        ...(nextOffset ? { next_offset: nextOffset } : {}),
        content: body,
      });
    },
  });
}

function suggestSimilar(absolute: string): string | undefined {
  try {
    const dir = dirname(absolute);
    const base = basename(absolute).toLowerCase();
    if (!existsSync(dir)) return undefined;
    const entries = readdirSync(dir);
    const hit = entries.find(
      (name) =>
        name.toLowerCase().includes(base.slice(0, Math.min(4, base.length))) ||
        base.includes(name.toLowerCase().slice(0, 4))
    );
    return hit ? join(dir, hit) : undefined;
  } catch {
    return undefined;
  }
}
