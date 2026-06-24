import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import type { BuiltinCuratedStore } from "./builtin-curated-store.js";

export function createMemoryTool(
  getStore: () => BuiltinCuratedStore | null,
  onWrite?: (target: "memory" | "user", content: string) => void
): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: "memory",
    description: `Manage persistent curated memory across sessions.
- target "memory": agent notes (facts, conventions, tool quirks)
- target "user": user profile (preferences, style, workflow)
Actions: add (append), replace (substring match), remove (substring match).
Mid-session writes update disk immediately; the next model call in the same turn refreshes injected memory context.`,
    schema: z.object({
      action: z.enum(["add", "replace", "remove"]),
      target: z.enum(["memory", "user"]).default("memory"),
      content: z.string().optional().describe("Content for add action"),
      old_text: z.string().optional().describe("Substring to match for replace/remove"),
      new_content: z
        .string()
        .optional()
        .describe("Replacement content for replace action"),
    }),
    func: async ({ action, target, content, old_text, new_content }) => {
      const store = getStore();
      if (!store) {
        return JSON.stringify({ success: false, error: "Memory store not initialized." });
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
