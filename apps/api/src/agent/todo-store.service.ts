import { Injectable } from "@nestjs/common";

export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
}

const VALID_STATUSES = new Set<TodoStatus>([
  "pending",
  "in_progress",
  "completed",
  "cancelled",
]);

@Injectable()
export class TodoStoreService {
  private readonly bySession = new Map<string, TodoItem[]>();

  read(sessionId: string): TodoItem[] {
    return (this.bySession.get(sessionId) ?? []).map((t) => ({ ...t }));
  }

  write(
    sessionId: string,
    todos: TodoItem[],
    merge = false
  ): TodoItem[] {
    const validated = todos
      .map((t) => this.validate(t))
      .filter((t): t is TodoItem => t !== null);

    if (!merge) {
      this.bySession.set(sessionId, validated);
      return this.read(sessionId);
    }

    const existing = new Map(
      (this.bySession.get(sessionId) ?? []).map((t) => [t.id, t])
    );
    for (const item of validated) {
      const prev = existing.get(item.id);
      existing.set(item.id, prev ? { ...prev, ...item } : item);
    }
    const merged = [...existing.values()];
    this.bySession.set(sessionId, merged);
    return this.read(sessionId);
  }

  formatForInjection(sessionId: string): string {
    const items = this.bySession.get(sessionId) ?? [];
    if (items.length === 0) return "";

    const markers: Record<TodoStatus, string> = {
      pending: "[ ]",
      in_progress: "[>]",
      completed: "[x]",
      cancelled: "[-]",
    };

    const lines = items.map(
      (t) => `${markers[t.status]} ${t.id}: ${t.content} (${t.status})`
    );
    return ["<todo-context>", "[Active task list — continue from in_progress items]", ...lines, "</todo-context>"].join("\n");
  }

  clear(sessionId: string): void {
    this.bySession.delete(sessionId);
  }

  private validate(raw: Partial<TodoItem>): TodoItem | null {
    const id = raw.id?.trim();
    const content = raw.content?.trim();
    const status = raw.status;
    if (!id || !content) return null;
    if (!status || !VALID_STATUSES.has(status)) return null;
    return { id, content: content.slice(0, 4000), status };
  }
}
