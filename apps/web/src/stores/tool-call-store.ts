import { create } from "zustand";
import type { ToolCall, ToolMessage } from "langchain";
import {
  isToolResultError,
  parseTodoPayload,
  pickToolContext,
  summarizeToolResult,
  type TodoItem,
} from "@/lib/tool-trail";

export type ToolTrailStatus = "running" | "ok" | "error";

export type ToolTrailEntry = {
  id: string;
  name: string;
  context: string;
  status: ToolTrailStatus;
  summary?: string;
  startedAt: number;
  endedAt?: number;
  error?: boolean;
};

/** Normalize socket/hydrate ToolMessage (class or LangChain lc JSON). */
export function normalizeToolMessage(raw: unknown): {
  tool_call_id: string;
  name?: string;
  content: unknown;
} {
  if (!raw || typeof raw !== "object") {
    return { tool_call_id: "", content: "" };
  }
  const obj = raw as Record<string, unknown>;
  const kwargs =
    obj.kwargs && typeof obj.kwargs === "object"
      ? (obj.kwargs as Record<string, unknown>)
      : null;
  const src = kwargs ?? obj;
  return {
    tool_call_id: String(src.tool_call_id ?? ""),
    name: typeof src.name === "string" ? src.name : undefined,
    content: src.content ?? "",
  };
}

/** Normalize socket/hydrate ToolCall (plain or partial). */
export function normalizeToolCall(raw: unknown): {
  id: string;
  name: string;
  args: unknown;
} {
  if (!raw || typeof raw !== "object") {
    return { id: "", name: "tool", args: {} };
  }
  const obj = raw as Record<string, unknown>;
  const kwargs =
    obj.kwargs && typeof obj.kwargs === "object"
      ? (obj.kwargs as Record<string, unknown>)
      : null;
  const src = kwargs ?? obj;
  return {
    id: String(src.id ?? ""),
    name: String(src.name ?? "tool"),
    args: src.args ?? {},
  };
}

interface ToolCallState {
  toolCalls: ToolCall[];
  toolMessages: ToolMessage[];
  trail: ToolTrailEntry[];
  todos: TodoItem[];
  todoCollapsed: boolean;
}

interface ToolCallStore extends ToolCallState {
  addToolCalls: (calls: ToolCall[]) => void;
  addToolMessage: (message: ToolMessage) => void;
  setTodoCollapsed: (collapsed: boolean) => void;
  toggleTodoCollapsed: () => void;
  reset: () => void;
  restore: (calls: ToolCall[], messages: ToolMessage[]) => void;
}

function upsertRunningEntry(
  trail: ToolTrailEntry[],
  call: { id: string; name: string; args: unknown },
  now = Date.now()
): ToolTrailEntry[] {
  if (call.name === "todo") return trail;
  const id = call.id || call.name;
  const context = pickToolContext(call.args);
  const existing = trail.findIndex((e) => e.id === id);
  const entry: ToolTrailEntry = {
    id,
    name: call.name,
    context,
    status: "running",
    startedAt: now,
  };
  if (existing >= 0) {
    const next = [...trail];
    next[existing] = {
      ...next[existing]!,
      ...entry,
      startedAt: next[existing]!.startedAt,
    };
    return next;
  }
  return [...trail, entry];
}

function completeEntry(
  trail: ToolTrailEntry[],
  message: { tool_call_id: string; name?: string; content: unknown },
  now = Date.now()
): ToolTrailEntry[] {
  const name = message.name?.trim() || "tool";
  if (name === "todo") return trail;

  const content = message.content;
  const error = isToolResultError(content);
  const summary = summarizeToolResult(content);
  const id = message.tool_call_id;
  const idx = id ? trail.findIndex((e) => e.id === id) : -1;

  if (idx >= 0) {
    const prev = trail[idx]!;
    const next = [...trail];
    next[idx] = {
      ...prev,
      name: prev.name || name,
      status: error ? "error" : "ok",
      summary,
      endedAt: now,
      error,
    };
    return next;
  }

  if (!id) return trail;
  return [
    ...trail,
    {
      id,
      name,
      context: "",
      status: error ? "error" : "ok",
      summary,
      startedAt: now,
      endedAt: now,
      error,
    },
  ];
}

function buildTrailFromHistory(
  calls: ToolCall[],
  messages: ToolMessage[]
): { trail: ToolTrailEntry[]; todos: TodoItem[] } {
  let trail: ToolTrailEntry[] = [];
  let todos: TodoItem[] = [];
  const base = Date.now() - Math.max(calls.length, 1) * 1000;
  const normalizedCalls = calls.map((c) => normalizeToolCall(c));

  normalizedCalls.forEach((call, i) => {
    trail = upsertRunningEntry(trail, call, base + i * 1000);
  });

  messages.forEach((message, i) => {
    const normalized = normalizeToolMessage(message);
    const matching = normalizedCalls.find((c) => c.id === normalized.tool_call_id);
    const name = normalized.name || matching?.name || "tool";
    if (name === "todo") {
      const parsed = parseTodoPayload(normalized.content);
      if (parsed) todos = parsed;
      return;
    }
    trail = completeEntry(
      trail,
      { ...normalized, name },
      base + normalizedCalls.length * 1000 + i * 100
    );
  });

  return { trail, todos };
}

const initialState: ToolCallState = {
  toolCalls: [],
  toolMessages: [],
  trail: [],
  todos: [],
  todoCollapsed: false,
};

export const useToolCallStore = create<ToolCallStore>((set) => ({
  ...initialState,
  addToolCalls: (calls: ToolCall[]) =>
    set((state) => {
      let trail = state.trail;
      for (const call of calls) {
        trail = upsertRunningEntry(trail, normalizeToolCall(call));
      }
      return {
        toolCalls: [...state.toolCalls, ...calls],
        trail,
      };
    }),
  addToolMessage: (message: ToolMessage) =>
    set((state) => {
      const normalized = normalizeToolMessage(message);
      const matching = state.toolCalls
        .map((c) => normalizeToolCall(c))
        .find((c) => c.id === normalized.tool_call_id);
      const name = normalized.name || matching?.name || "tool";

      if (name === "todo") {
        const parsed = parseTodoPayload(normalized.content);
        return {
          toolMessages: [...state.toolMessages, message],
          ...(parsed ? { todos: parsed } : {}),
        };
      }

      return {
        toolMessages: [...state.toolMessages, message],
        trail: completeEntry(state.trail, { ...normalized, name }),
      };
    }),
  setTodoCollapsed: (collapsed: boolean) => set({ todoCollapsed: collapsed }),
  toggleTodoCollapsed: () =>
    set((state) => ({ todoCollapsed: !state.todoCollapsed })),
  reset: () => set({ ...initialState }),
  restore: (calls: ToolCall[], messages: ToolMessage[]) => {
    const { trail, todos } = buildTrailFromHistory(calls, messages);
    set({
      toolCalls: calls,
      toolMessages: messages,
      trail,
      todos,
      todoCollapsed:
        todos.length > 0 &&
        todos.every(
          (t) => t.status === "completed" || t.status === "cancelled"
        ),
    });
  },
}));
