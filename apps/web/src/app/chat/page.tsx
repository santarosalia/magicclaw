"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import { ToolCallFlow } from "@/components/ToolCallFlow";
import { useAgentSocket } from "@/lib/useAgentSocket";
import {
  deleteSession,
  listSessions,
  type SessionRecord,
} from "@/lib/sessions-api";

export default function ChatPage() {
  const [input, setInput] = useState("");
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const {
    userId,
    conversationId,
    connecting,
    connected,
    loading,
    streamingContent,
    messages,
    sendChat,
    startNewConversation,
    clearCurrentConversation,
    resumeConversation,
  } = useAgentSocket();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sessionListRef = useRef<HTMLDivElement>(null);
  const shouldScrollMessagesRef = useRef(false);
  const prevLoadingRef = useRef(false);

  const refreshSessions = useCallback(async () => {
    if (!userId) return;
    const rows = await listSessions(userId);
    setSessions(rows);
  }, [userId]);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  useEffect(() => {
    if (prevLoadingRef.current && !loading) {
      void refreshSessions();
    }
    prevLoadingRef.current = loading;
  }, [loading, refreshSessions]);

  useEffect(() => {
    if (loading) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    if (!shouldScrollMessagesRef.current) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    shouldScrollMessagesRef.current = false;
  }, [messages, streamingContent, loading]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    const wasNew = !conversationId;
    setInput("");
    shouldScrollMessagesRef.current = true;
    await sendChat(text);
    if (wasNew) {
      await refreshSessions();
    }
  }, [conversationId, input, loading, refreshSessions, sendChat]);

  const handleNewChat = useCallback(async () => {
    await startNewConversation();
    await refreshSessions();
  }, [refreshSessions, startNewConversation]);

  const handleResume = useCallback(
    async (sessionId: string) => {
      await resumeConversation(sessionId);
      requestAnimationFrame(() => {
        const el = sessionListRef.current?.querySelector(
          `[data-session-id="${sessionId}"]`
        );
        el?.scrollIntoView({ block: "nearest" });
      });
    },
    [resumeConversation]
  );

  const handleDelete = useCallback(
    async (sessionId: string) => {
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      try {
        await deleteSession(sessionId);
        if (conversationId === sessionId) {
          clearCurrentConversation();
        }
        await refreshSessions();
      } catch (error) {
        await refreshSessions();
        throw error;
      }
    },
    [clearCurrentConversation, conversationId, refreshSessions]
  );

  return (
    <main className="h-screen flex flex-col p-6">
      <div className="flex items-center gap-2 mb-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="text-xl font-semibold">채팅</h1>
        <Button variant="outline" size="sm" className="ml-auto" asChild>
          <Link href="/memory">메모리 설정</Link>
        </Button>
      </div>
      <div className="flex flex-1 gap-4 min-h-0">
        <Card className="w-64 shrink-0 flex flex-col min-h-0">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm">대화 목록</CardTitle>
            <Button size="icon" variant="ghost" onClick={() => void handleNewChat()}>
              <Plus className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent
            ref={sessionListRef}
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
                    onClick={() => void handleResume(s.id)}
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
                      void handleDelete(s.id);
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="flex flex-col min-h-0 flex-2">
          <CardContent className="flex-1 overflow-auto p-4 space-y-4">
            {messages.length === 0 && (
              <p className="text-muted-foreground text-sm text-center py-8">
                메시지를 입력하면 새 대화가 자동으로 시작됩니다.
              </p>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={
                  m.role === "user"
                    ? "ml-auto max-w-[85%] rounded-lg bg-primary text-primary-foreground px-4 py-2"
                    : "mr-auto max-w-[85%] rounded-lg border bg-card px-4 py-2"
                }
              >
                {m.role === "user" ? (
                  <p className="text-sm whitespace-pre-wrap">{m.content}</p>
                ) : (
                  <div className="markdown-content prose prose-invert max-w-none">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      rehypePlugins={[rehypeRaw, rehypeHighlight]}
                    >
                      {m.content}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
            ))}
            {loading && streamingContent ? (
              <div className="mr-auto max-w-[85%] rounded-lg border border-primary/20 bg-card px-4 py-2">
                <div className="markdown-content prose prose-invert max-w-none">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeRaw, rehypeHighlight]}
                  >
                    {streamingContent}
                  </ReactMarkdown>
                </div>
              </div>
            ) : null}
            {(loading || connecting) && !streamingContent ? (
              <div className="flex items-center gap-2 rounded-lg border border-primary/20 px-3 py-2 text-muted-foreground text-sm">
                <span>
                  {connecting
                    ? "서버에 연결 중..."
                    : connected
                      ? "응답 중..."
                      : "연결이 끊어졌습니다."}
                </span>
              </div>
            ) : null}
            <div ref={messagesEndRef} />
          </CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
            className="p-4 border-t flex gap-2"
          >
            <Input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="메시지 입력..."
              disabled={loading}
              className="flex-1"
            />
            <Button
              type="submit"
              disabled={loading || !input.trim()}
              size="icon"
            >
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </Card>

        <Card className="overflow-hidden flex-1 h-full">
          <CardContent className="p-2 h-full flex flex-col">
            <ToolCallFlow className="w-full rounded-md flex-1" />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
