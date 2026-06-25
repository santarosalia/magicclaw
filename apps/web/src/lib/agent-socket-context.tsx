"use client";

import { ToolCall, ToolMessage } from "langchain";
import { load } from "@langchain/core/load";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { io, type Socket } from "socket.io-client";
import { useToolCallStore } from "@/stores/tool-call-store";
import { getOrCreateUserId } from "@/lib/user-id";
import {
  createSession,
  loadSessionMessages,
  type SessionRecord,
} from "@/lib/sessions-api";
import { hydrateSessionMessages } from "@/lib/session-messages";

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type AgentSocketEvent =
  | {
      type: "tool_call";
      toolCall: ToolCall;
    }
  | {
      type: "tool_message";
      toolMessage: ToolMessage;
    }
  | {
      type: "assistant_message";
      content: string;
    }
  | {
      type: "final_message";
      message: string;
      toolCallsUsed: number;
      toolCalls: { name: string; args: Record<string, unknown> }[];
    };

interface AgentSocketValue {
  userId: string;
  conversationId: string | null;
  connecting: boolean;
  connected: boolean;
  events: AgentSocketEvent[];
  loading: boolean;
  streamingContent: string;
  messages: ChatMessage[];
  sendChat: (userMessage: string, model?: string) => Promise<void>;
  startNewConversation: () => Promise<void>;
  clearCurrentConversation: () => void;
  resumeConversation: (sessionId: string) => Promise<void>;
}

const AgentSocketContext = createContext<AgentSocketValue | null>(null);

export function AgentSocketProvider({ children }: { children: ReactNode }) {
  const socketRef = useRef<Socket | null>(null);
  const [userId, setUserId] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<AgentSocketEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const streamingContentRef = useRef("");
  const conversationIdRef = useRef<string | null>(null);
  const {
    addToolCalls,
    addToolMessage,
    reset: resetToolCallStore,
    restore: restoreToolCallStore,
  } = useToolCallStore();

  useEffect(() => {
    setUserId(getOrCreateUserId());
  }, []);

  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  useEffect(() => {
    setConnecting(true);
    const apiOrigin =
      process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://localhost:4000";
    const url = apiOrigin.replace(/\/$/, "") + "/agent";

    const socket = io(url, {
      transports: ["websocket"],
      autoConnect: true,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      setConnecting(false);
    });

    socket.on("disconnect", () => {
      setConnected(false);
    });

    socket.on("session_created", (payload: { sessionId: string }) => {
      // 서버가 새 세션을 만든 경우에만 적용 (사용자가 다른 대화를 선택한 뒤 덮어쓰지 않음)
      if (!conversationIdRef.current) {
        conversationIdRef.current = payload.sessionId;
        setConversationId(payload.sessionId);
      }
    });

    socket.on("agent_event", (event: AgentSocketEvent) => {
      setEvents((prev) => [...prev, event]);

      switch (event.type) {
        case "tool_call":
          addToolCalls([event.toolCall as ToolCall]);
          break;
        case "tool_message":
          load<ToolMessage>(JSON.stringify(event.toolMessage)).then((tm) =>
            addToolMessage(tm)
          );
          break;
        case "assistant_message":
          setStreamingContent((prev) => {
            const next = prev + event.content;
            streamingContentRef.current = next;
            return next;
          });
          break;
        case "final_message":
          setMessages((msgs) => [
            ...msgs,
            { role: "assistant", content: streamingContentRef.current },
          ]);
          setStreamingContent("");
          setLoading(false);
          break;
      }
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [addToolCalls, addToolMessage]);

  const sendChat = useCallback(
    async (userMessage: string, model?: string) => {
      if (!socketRef.current) {
        throw new Error("소켓이 연결되지 않았습니다.");
      }
      if (!userId) {
        throw new Error("사용자 정보를 불러오는 중입니다.");
      }

      let activeSessionId = conversationIdRef.current;
      if (!activeSessionId) {
        try {
          const session = await createSession(userId);
          activeSessionId = session.id;
          conversationIdRef.current = activeSessionId;
          setConversationId(activeSessionId);
        } catch (error) {
          setMessages((prev) => [
            ...prev,
            { role: "user", content: userMessage },
            {
              role: "assistant",
              content:
                "오류: " +
                (error instanceof Error ? error.message : String(error)),
            },
          ]);
          return;
        }
      }

      setEvents([]);
      resetToolCallStore();
      streamingContentRef.current = "";
      setStreamingContent("");
      setLoading(true);
      setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
      try {
        socketRef.current.emit("chat", {
          userMessage,
          model,
          userId,
          conversationId: activeSessionId,
        });
      } catch (error) {
        setLoading(false);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content:
              "오류: " +
              (error instanceof Error ? error.message : String(error)),
          },
        ]);
      }
    },
    [resetToolCallStore, userId]
  );

  const clearCurrentConversation = useCallback(() => {
    conversationIdRef.current = null;
    setConversationId(null);
    setMessages([]);
    setEvents([]);
    resetToolCallStore();
    streamingContentRef.current = "";
    setStreamingContent("");
    setLoading(false);
  }, [resetToolCallStore]);

  const startNewConversation = useCallback(async () => {
    const session: SessionRecord = await createSession(userId);
    conversationIdRef.current = session.id;
    setConversationId(session.id);
    setMessages([]);
    setEvents([]);
    resetToolCallStore();
    streamingContentRef.current = "";
    setStreamingContent("");
    return session.id;
  }, [resetToolCallStore, userId]);

  const resumeConversation = useCallback(
    async (sessionId: string) => {
      conversationIdRef.current = sessionId;
      setConversationId(sessionId);
      setEvents([]);
      resetToolCallStore();
      streamingContentRef.current = "";
      setStreamingContent("");
      setLoading(false);

      try {
        const rows = await loadSessionMessages(sessionId);
        const hydrated = await hydrateSessionMessages(rows);
        setMessages(hydrated.chatMessages);
        restoreToolCallStore(hydrated.toolCalls, hydrated.toolMessages);
      } catch {
        setMessages([]);
        resetToolCallStore();
      }
    },
    [resetToolCallStore, restoreToolCallStore]
  );

  return (
    <AgentSocketContext.Provider
      value={{
        userId,
        conversationId,
        connecting,
        connected,
        events,
        loading,
        streamingContent,
        messages,
        sendChat,
        startNewConversation,
        clearCurrentConversation,
        resumeConversation,
      }}
    >
      {children}
    </AgentSocketContext.Provider>
  );
}

export function useAgentSocket(): AgentSocketValue {
  const ctx = useContext(AgentSocketContext);
  if (!ctx) {
    throw new Error("useAgentSocket must be used within AgentSocketProvider");
  }
  return ctx;
}
