"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ToolCallFlow } from "@/components/ToolCallFlow";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { ChatMessageList } from "@/components/chat/ChatMessageList";
import { ChatSessionSidebar } from "@/components/chat/ChatSessionSidebar";
import { useAgentSocket } from "@/lib/useAgentSocket";
import {
  deleteSession,
  listSessions,
  type SessionRecord,
} from "@/lib/sessions-api";

export default function ChatPage() {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const {
    userId,
    conversationId,
    connecting,
    connected,
    loading,
    streamingContent,
    intermediateMessages,
    streamAsAnswer,
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
  const conversationIdRef = useRef(conversationId);

  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

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
  }, [messages, streamingContent, intermediateMessages, loading]);

  const send = useCallback(
    async (text: string) => {
      if (loading) return;
      const wasNew = !conversationIdRef.current;
      shouldScrollMessagesRef.current = true;
      await sendChat(text);
      if (wasNew) {
        await refreshSessions();
      }
    },
    [loading, refreshSessions, sendChat]
  );

  const handleNewChat = useCallback(() => {
    void startNewConversation().then(() => refreshSessions());
  }, [refreshSessions, startNewConversation]);

  const handleResume = useCallback(
    (sessionId: string) => {
      void resumeConversation(sessionId);
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
    (sessionId: string) => {
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      void (async () => {
        try {
          await deleteSession(sessionId);
          if (conversationIdRef.current === sessionId) {
            clearCurrentConversation();
          }
          await refreshSessions();
        } catch {
          await refreshSessions();
        }
      })();
    },
    [clearCurrentConversation, refreshSessions]
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
        <ChatSessionSidebar
          sessions={sessions}
          conversationId={conversationId}
          listRef={sessionListRef}
          onNewChat={handleNewChat}
          onResume={handleResume}
          onDelete={handleDelete}
        />

        <Card className="flex flex-col min-h-0 flex-2">
          <CardContent className="flex-1 overflow-auto p-4 space-y-4">
            <ChatMessageList
              messages={messages}
              streamingContent={streamingContent}
              intermediateMessages={intermediateMessages}
              streamAsAnswer={streamAsAnswer}
              loading={loading}
              connecting={connecting}
              connected={connected}
              messagesEndRef={messagesEndRef}
            />
          </CardContent>
          <ChatComposer disabled={loading} onSend={send} />
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
