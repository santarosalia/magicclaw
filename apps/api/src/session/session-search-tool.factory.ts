import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import type { SessionSearchService } from "./session-search.service.js";

const SESSION_SEARCH_DESCRIPTION = `Search past MagicClaw sessions in the local SQLite DB, or scroll inside one. FTS5-backed — no LLM calls.

CALLING SHAPES (mode inferred from args):
1) DISCOVERY — pass query: returns top sessions with snippet, ±5 message window, bookends (first/last 3 user+assistant msgs).
2) SCROLL — pass session_id + around_message_id: returns ±window messages centered on anchor. Re-anchor on messages[-1].id to scroll forward.
3) READ — pass session_id only: dumps session (first 20 + last 10 when large).
4) BROWSE — no args: recent sessions with titles and previews.

Use when the user asks about prior conversations ("what did we do about X", "where did we leave off"). Inspect live sources first when the user gave a URL/file/account — session_search is history, not current world state.

FTS5: multi-word queries are AND by default. Use OR, quoted phrases, or prefix wildcards (deploy*) for broader recall.`;

export function createSessionSearchTool(
  userId: string,
  currentSessionId: string,
  searchService: SessionSearchService
): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: "session_search",
    description: SESSION_SEARCH_DESCRIPTION,
    schema: z.object({
      query: z
        .string()
        .optional()
        .describe("Discovery: keywords or FTS5 boolean query."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe("Discovery: max sessions (default 3)."),
      session_id: z
        .string()
        .optional()
        .describe("Scroll/read: target session id."),
      around_message_id: z
        .number()
        .int()
        .optional()
        .describe("Scroll: anchor message id."),
      window: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe("Scroll: messages before/after anchor (default 5)."),
    }),
    func: async ({ query, limit, session_id, around_message_id, window }) =>
      searchService.search(userId, {
        query,
        limit,
        sessionId: session_id,
        aroundMessageId: around_message_id,
        window,
        currentSessionId,
      }),
  });
}
