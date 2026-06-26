"use client";

import { memo } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SessionRecord } from "@/lib/sessions-api";

interface ChatSessionSidebarProps {
  sessions: SessionRecord[];
  conversationId: string | null;
  listRef: React.RefObject<HTMLDivElement | null>;
  onNewChat: () => void;
  onResume: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
}

export const ChatSessionSidebar = memo(function ChatSessionSidebar({
  sessions,
  conversationId,
  listRef,
  onNewChat,
  onResume,
  onDelete,
}: ChatSessionSidebarProps) {
  return (
    <Card className="w-64 shrink-0 flex flex-col min-h-0">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm">대화 목록</CardTitle>
        <Button size="icon" variant="ghost" onClick={onNewChat}>
          <Plus className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent
        ref={listRef}
        className="flex-1 overflow-auto p-2 space-y-1"
      >
        {sessions.length === 0 ? (
          <p className="text-xs text-muted-foreground p-2">대화가 없습니다.</p>
        ) : (
          sessions.map((s) => (
            <div
              key={s.id}
              data-session-id={s.id}
              className={`flex items-center gap-1 rounded-md border px-2 py-1.5 text-xs ${
                conversationId === s.id ? "bg-accent border-primary/40" : ""
              }`}
            >
              <button
                type="button"
                className="flex-1 text-left truncate"
                onClick={() => onResume(s.id)}
              >
                {s.title || "대화"}
              </button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-6 w-6 shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(s.id);
                }}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
});
