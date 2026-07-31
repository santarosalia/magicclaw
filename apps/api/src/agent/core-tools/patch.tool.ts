import { existsSync } from "node:fs";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { applyReplacePatch } from "./patch-ops.js";
import { ensureWorkspaceRoot, resolveToolPath } from "./workspace.js";

export function createPatchTool(workspaceRoot: string): DynamicStructuredTool {
  const root = ensureWorkspaceRoot(workspaceRoot);

  return new DynamicStructuredTool({
    name: "patch",
    description:
      "Edit an existing file. Prefer mode='replace' with path + old_string + new_string " +
      "(unique match unless replace_all=true). Use this instead of sed/awk in terminal.",
    schema: z.object({
      mode: z
        .enum(["replace", "patch"])
        .optional()
        .default("replace")
        .describe("'replace' (default) or 'patch' (not yet supported — use replace)"),
      path: z.string().optional().describe("Required for mode=replace"),
      old_string: z
        .string()
        .optional()
        .describe("Exact text to find (must be unique unless replace_all)"),
      new_string: z
        .string()
        .optional()
        .describe("Replacement text (empty string deletes the match)"),
      replace_all: z
        .boolean()
        .optional()
        .default(false)
        .describe("Replace all occurrences"),
      patch: z
        .string()
        .optional()
        .describe("V4A patch content (mode=patch) — not implemented yet"),
    }),
    func: async ({ mode, path, old_string, new_string, replace_all, patch }) => {
      if (mode === "patch") {
        return JSON.stringify({
          success: false,
          error:
            "mode='patch' (V4A) is not implemented yet. Use mode='replace' with path, old_string, new_string.",
          ...(patch ? { hint: "Received patch payload but ignored" } : {}),
        });
      }

      if (!path || old_string === undefined || new_string === undefined) {
        return JSON.stringify({
          success: false,
          error: "mode=replace requires path, old_string, and new_string",
        });
      }

      const absolute = resolveToolPath(path, root);
      if (!existsSync(absolute)) {
        return JSON.stringify({
          success: false,
          error: `File not found: ${absolute}`,
        });
      }

      const result = applyReplacePatch(
        absolute,
        old_string,
        new_string,
        replace_all ?? false
      );
      if (!result.ok) {
        return JSON.stringify({ success: false, error: result.error });
      }
      return JSON.stringify({
        success: true,
        path: absolute,
        replacements: result.replacements,
      });
    },
  });
}
