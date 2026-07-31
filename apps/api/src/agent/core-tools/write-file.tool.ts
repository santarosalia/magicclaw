import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { ensureWorkspaceRoot, resolveToolPath } from "./workspace.js";

export function createWriteFileTool(workspaceRoot: string): DynamicStructuredTool {
  const root = ensureWorkspaceRoot(workspaceRoot);

  return new DynamicStructuredTool({
    name: "write_file",
    description:
      "Write content to a file, completely replacing existing content. " +
      "Use this instead of echo/cat heredoc in terminal. Creates parent directories. " +
      "OVERWRITES the entire file — use patch for targeted edits.",
    schema: z.object({
      path: z
        .string()
        .describe("Path to write (created if missing, overwritten if present)"),
      content: z.string().describe("Complete content to write to the file"),
    }),
    func: async ({ path, content }) => {
      const absolute = resolveToolPath(path, root);
      try {
        mkdirSync(dirname(absolute), { recursive: true });
        writeFileSync(absolute, content, "utf8");
        return JSON.stringify({
          success: true,
          path: absolute,
          bytes: Buffer.byteLength(content, "utf8"),
        });
      } catch (err) {
        return JSON.stringify({
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  });
}
