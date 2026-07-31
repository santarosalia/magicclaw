/** Hermes-style compact labels for tool trail + todo parsing. */

export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

export type TodoItem = {
  id: string;
  content: string;
  status: TodoStatus;
};

const CONTEXT_KEYS = [
  "path",
  "file",
  "filename",
  "command",
  "cmd",
  "query",
  "url",
  "uri",
  "name",
  "id",
  "pattern",
  "search",
  "message",
  "content",
] as const;

const VALID_TODO_STATUSES = new Set<TodoStatus>([
  "pending",
  "in_progress",
  "completed",
  "cancelled",
]);

export function toolTrailLabel(name: string): string {
  return (
    name
      .split("_")
      .filter(Boolean)
      .map((p) => p[0]!.toUpperCase() + p.slice(1))
      .join(" ") || name
  );
}

export function compactPreview(text: string, max = 64): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, Math.max(0, max - 1))}…`;
}

export function pickToolContext(args: unknown): string {
  if (args == null) return "";
  if (typeof args === "string") return compactPreview(args, 64);
  if (typeof args !== "object") return compactPreview(String(args), 64);

  const record = args as Record<string, unknown>;
  for (const key of CONTEXT_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return compactPreview(value, 64);
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
  }

  try {
    return compactPreview(JSON.stringify(args), 64);
  } catch {
    return "";
  }
}

export function formatToolLabel(name: string, context = ""): string {
  const label = toolTrailLabel(name);
  const preview = compactPreview(context, 64);
  return preview ? `${label}("${preview}")` : label;
}

export function toolResultToString(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return (content as { type?: string; text?: string }[])
      .filter((x) => x.type === "text" && typeof x.text === "string")
      .map((x) => x.text as string)
      .join("");
  }
  if (content == null) return "";
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

export function summarizeToolResult(content: unknown, max = 72): string {
  return compactPreview(toolResultToString(content), max);
}

export function isToolResultError(content: unknown): boolean {
  const text = toolResultToString(content).trim();
  if (!text) return false;
  if (/^error\b/i.test(text)) return true;
  try {
    const parsed = JSON.parse(text) as { error?: unknown; ok?: unknown };
    if (parsed && typeof parsed === "object") {
      if (parsed.error != null) return true;
      if (parsed.ok === false) return true;
    }
  } catch {
    /* not json */
  }
  return false;
}

export function parseTodoPayload(content: unknown): TodoItem[] | null {
  const text = toolResultToString(content).trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as { todos?: unknown };
    if (!parsed || !Array.isArray(parsed.todos)) return null;
    const items: TodoItem[] = [];
    for (const raw of parsed.todos) {
      if (!raw || typeof raw !== "object") continue;
      const row = raw as Partial<TodoItem>;
      const id = typeof row.id === "string" ? row.id.trim() : "";
      const contentText =
        typeof row.content === "string" ? row.content.trim() : "";
      const status = row.status;
      if (!id || !contentText) continue;
      if (!status || !VALID_TODO_STATUSES.has(status)) continue;
      items.push({ id, content: contentText, status });
    }
    return items;
  } catch {
    return null;
  }
}

export function todoGlyph(status: TodoStatus): string {
  if (status === "completed") return "[x]";
  if (status === "cancelled") return "[-]";
  if (status === "in_progress") return "[>]";
  return "[ ]";
}

export function formatDurationSeconds(ms: number): string {
  const seconds = Math.max(0, ms) / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  return `${Math.round(seconds)}s`;
}
