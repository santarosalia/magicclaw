import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import type { BuiltinCuratedStore } from "./builtin-curated-store.js";

const MEMORY_TOOL_DESCRIPTION = `Save durable facts to persistent memory that survive across sessions. Memory is injected into every future turn — keep entries compact and high-signal.

HOW: prefer one call with an operations array [{action, content?, old_text?}]. The batch applies atomically; the char limit is checked only on the FINAL result — remove/replace stale entries and add new ones in the same call when full. Single-action fields (action/content/old_text) work for one change only.

WHEN: save proactively when the user states a preference, correction, or personal detail, or you learn a stable fact about their environment, conventions, or workflow. Priority: user preferences & corrections > environment facts > procedures.

TARGETS: "user" = who the user is (name, role, preferences, style). "memory" = your notes (environment, conventions, tool quirks, lessons).

SKIP: trivial/obvious info, easily re-discovered facts, raw data dumps, task progress, completed-work logs, temporary TODO state.`;

const operationSchema = z.object({
  action: z.enum(["add", "replace", "remove"]),
  content: z.string().optional(),
  old_text: z.string().optional(),
});

export function createMemoryTool(
  getStore: () => BuiltinCuratedStore | null,
  onWrite?: (target: "memory" | "user", content: string) => void
): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: "memory",
    description: MEMORY_TOOL_DESCRIPTION,
    schema: z.object({
      target: z
        .enum(["memory", "user"])
        .default("memory")
        .describe("memory = agent notes, user = user profile"),
      action: z
        .enum(["add", "replace", "remove"])
        .optional()
        .describe("Single-op action. Omit when using operations."),
      content: z.string().optional().describe("Content for add/replace (single-op)"),
      old_text: z
        .string()
        .optional()
        .describe("Substring match for replace/remove (single-op)"),
      new_content: z
        .string()
        .optional()
        .describe("Replacement text for replace (single-op)"),
      operations: z
        .array(operationSchema)
        .optional()
        .describe(
          "Batch ops applied atomically against final char budget. Preferred for multiple changes or when memory is full."
        ),
    }),
    func: async ({
      action,
      target,
      content,
      old_text,
      new_content,
      operations,
    }) => {
      const store = getStore();
      if (!store) {
        return JSON.stringify({
          success: false,
          error: "Memory store not initialized.",
        });
      }

      if (operations?.length) {
        const result = store.applyBatch(target, operations);
        if (result.success) {
          for (const op of operations) {
            if (op.action === "add" && op.content?.trim()) {
              onWrite?.(target, op.content.trim());
            }
            if (op.action === "replace" && op.content?.trim()) {
              onWrite?.(target, op.content.trim());
            }
          }
        }
        return JSON.stringify(result);
      }

      if (!action) {
        return JSON.stringify({
          success: false,
          error: "Provide action or operations.",
        });
      }

      let result;
      if (action === "add") {
        result = store.add(target, content ?? "");
        if (result.success && content) onWrite?.(target, content);
      } else if (action === "replace") {
        result = store.replace(target, old_text ?? "", new_content ?? "");
        if (result.success && new_content) onWrite?.(target, new_content);
      } else {
        result = store.remove(target, old_text ?? "");
      }

      return JSON.stringify(result);
    },
  });
}
