import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { processRegistry } from "./process-registry.js";

export function createProcessTool(): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: "process",
    description:
      "Manage background processes started with terminal(background=true). " +
      "Actions: 'list', 'poll' (new output), 'log' (paginated), 'wait', 'kill', " +
      "'write' (stdin without newline), 'submit' (stdin + Enter), 'close' (EOF).",
    schema: z.object({
      action: z.enum([
        "list",
        "poll",
        "log",
        "wait",
        "kill",
        "write",
        "submit",
        "close",
      ]),
      session_id: z
        .string()
        .optional()
        .describe("Required for all actions except list"),
      data: z
        .string()
        .optional()
        .describe("Text for write/submit actions"),
      timeout: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Max seconds for wait (default 60)"),
      offset: z.number().int().optional().describe("Line offset for log"),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Max lines for log (default 200)"),
    }),
    func: async ({ action, session_id, data, timeout, offset, limit }) => {
      try {
        if (action === "list") {
          return JSON.stringify({ processes: processRegistry.list() });
        }
        if (!session_id) {
          return JSON.stringify({
            error: "session_id is required for this action",
          });
        }
        switch (action) {
          case "poll":
            return JSON.stringify(processRegistry.poll(session_id));
          case "log":
            return JSON.stringify(
              processRegistry.log(session_id, offset, limit ?? 200)
            );
          case "wait":
            return JSON.stringify(
              await processRegistry.wait(session_id, timeout ?? 60)
            );
          case "kill":
            return JSON.stringify(processRegistry.kill(session_id));
          case "write":
            return JSON.stringify(
              processRegistry.write(session_id, data ?? "", false)
            );
          case "submit":
            return JSON.stringify(
              processRegistry.write(session_id, data ?? "", true)
            );
          case "close":
            return JSON.stringify(processRegistry.closeStdin(session_id));
          default:
            return JSON.stringify({ error: `Unknown action: ${action}` });
        }
      } catch (err) {
        return JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  });
}
