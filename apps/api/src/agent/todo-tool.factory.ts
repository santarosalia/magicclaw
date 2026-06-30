import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import type { TodoStoreService } from "./todo-store.service.js";

export function createTodoTool(
  sessionId: string,
  todoStore: TodoStoreService
): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: "todo",
    description: `Session task list for multi-step work. Omit todos to read the list.
Write with todos array: {id, content, status}. status: pending|in_progress|completed|cancelled.
Use merge=true to update by id. List order is priority.`,
    schema: z.object({
      todos: z
        .array(
          z.object({
            id: z.string(),
            content: z.string(),
            status: z.enum([
              "pending",
              "in_progress",
              "completed",
              "cancelled",
            ]),
          })
        )
        .optional(),
      merge: z.boolean().optional().default(false),
    }),
    func: async ({ todos, merge }) => {
      if (!todos || todos.length === 0) {
        return JSON.stringify({ todos: todoStore.read(sessionId) });
      }
      const result = todoStore.write(sessionId, todos, merge ?? false);
      return JSON.stringify({ todos: result });
    },
  });
}
