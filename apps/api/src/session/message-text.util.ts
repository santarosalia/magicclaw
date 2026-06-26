import type { BaseMessage } from "langchain";
import { getMessageContentAsString } from "../agent/agent.types.js";

/** Plain text for FTS indexing and session_search snippets. */
export function extractSearchableText(message: BaseMessage): string {
  const role = message.getType();
  const body = getMessageContentAsString(message).trim();
  if (!body) return "";
  return `${role}: ${body}`;
}

export function shapeMessageForSearch(row: {
  id: number;
  role: string;
  search_text: string | null;
  created_at: number;
}): { id: number; role: string; content: string; timestamp: number } {
  const text = row.search_text ?? "";
  const prefix = `${row.role}: `;
  const content = text.startsWith(prefix)
    ? text.slice(prefix.length)
    : text;
  return {
    id: row.id,
    role: row.role,
    content,
    timestamp: row.created_at,
  };
}
