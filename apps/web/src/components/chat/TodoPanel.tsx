"use client";

import { useToolCallStore } from "@/stores/tool-call-store";
import { todoGlyph, type TodoItem, type TodoStatus } from "@/lib/tool-trail";
import { cn } from "@/lib/utils";

function rowClass(status: TodoStatus): string {
  if (status === "in_progress") return "text-foreground";
  if (status === "pending") return "text-muted-foreground";
  return "text-muted-foreground/70";
}

export function TodoPanel({ className }: { className?: string }) {
  const todos = useToolCallStore((s) => s.todos);
  const collapsed = useToolCallStore((s) => s.todoCollapsed);
  const toggleTodoCollapsed = useToolCallStore((s) => s.toggleTodoCollapsed);

  if (!todos.length) return null;

  const done = todos.filter((t) => t.status === "completed").length;
  const pending = todos.filter(
    (t) => t.status === "pending" || t.status === "in_progress"
  ).length;

  return (
    <div
      className={cn(
        "mb-1 rounded-lg border bg-muted/30 px-3 py-2 text-sm",
        className
      )}
    >
      <button
        type="button"
        onClick={toggleTodoCollapsed}
        className="flex w-full items-baseline gap-1 text-left text-muted-foreground hover:text-foreground"
      >
        <span className="text-foreground/80">{collapsed ? "▸" : "▾"}</span>
        <span className="font-medium text-foreground">Todo</span>
        <span className="text-xs">
          ({done}/{todos.length})
        </span>
        {pending > 0 && done > 0 ? (
          <span className="text-xs">· {pending} pending</span>
        ) : null}
      </button>
      {!collapsed ? (
        <ul className="mt-1.5 ml-3 space-y-0.5 font-mono text-xs">
          {todos.map((todo: TodoItem) => (
            <li key={todo.id} className={rowClass(todo.status)}>
              <span className="mr-1.5">{todoGlyph(todo.status)}</span>
              {todo.content}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
