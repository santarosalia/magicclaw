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
import { splitModelThinkBlocks } from "@/lib/model-think";

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  /** 도구 라운드 중간 서술 — UI에서 접힌 토글로만 표시 */
  intermediate?: string[];
};

export type AgentSocketEvent =
  | {
      type: "tool_call";
      toolCall: ToolCall;
      sessionId?: string;
    }
  | {
      type: "tool_message";
      toolMessage: ToolMessage;
      sessionId?: string;
    }
  | {
      type: "assistant_message";
      content: string;
      sessionId?: string;
    }
  | {
      type: "intermediate_message";
      content: string;
      sessionId?: string;
    }
  | {
      type: "final_message";
      message: string;
      sessionId?: string;
      toolCallsUsed?: number;
      toolCalls?: { name: string; args: Record<string, unknown> }[];
    };

type LiveTurn = {
  streamingContent: string;
  intermediateMessages: string[];
  toolsSeen: boolean;
  loading: boolean;
};

function emptyLiveTurn(): LiveTurn {
  return {
    streamingContent: "",
    intermediateMessages: [],
    toolsSeen: false,
    loading: false,
  };
}

function eventContentToString(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return (content as { type?: string; text?: string }[])
      .filter((x) => x.type === "text" && typeof x.text === "string")
      .map((x) => x.text as string)
      .join("");
  }
  return content == null ? "" : String(content);
}

interface AgentSocketValue {
  userId: string;
  conversationId: string | null;
  connecting: boolean;
  connected: boolean;
  events: AgentSocketEvent[];
  loading: boolean;
  streamingContent: string;
  intermediateMessages: string[];
  /** true 면 현재 스트림을 채팅(최종 답)에, false 면 생각 과정에 표시 */
  streamAsAnswer: boolean;
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
  const [intermediateMessages, setIntermediateMessages] = useState<string[]>(
    []
  );
  /** 이번 턴에 tool_call 을 한 번이라도 받았으면 이후 스트림은 최종 답 영역으로 */
  const [toolsSeenThisTurn, setToolsSeenThisTurn] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const streamingContentRef = useRef("");
  const intermediateMessagesRef = useRef<string[]>([]);
  const toolsSeenThisTurnRef = useRef(false);
  const conversationIdRef = useRef<string | null>(null);
  /** 세션별 진행 중 스트림 — 대화 전환 후에도 서로 섞이지 않게 보관 */
  const liveTurnsRef = useRef<Map<string, LiveTurn>>(new Map());
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

    const getLive = (sessionId: string): LiveTurn => {
      let turn = liveTurnsRef.current.get(sessionId);
      if (!turn) {
        turn = emptyLiveTurn();
        liveTurnsRef.current.set(sessionId, turn);
      }
      return turn;
    };

    const syncLiveToUi = (sessionId: string) => {
      if (sessionId !== conversationIdRef.current) return;
      const turn = getLive(sessionId);
      streamingContentRef.current = turn.streamingContent;
      setStreamingContent(turn.streamingContent);
      intermediateMessagesRef.current = turn.intermediateMessages;
      setIntermediateMessages([...turn.intermediateMessages]);
      toolsSeenThisTurnRef.current = turn.toolsSeen;
      setToolsSeenThisTurn(turn.toolsSeen);
      setLoading(turn.loading);
    };

    const clearUiStream = () => {
      streamingContentRef.current = "";
      setStreamingContent("");
      intermediateMessagesRef.current = [];
      setIntermediateMessages([]);
      toolsSeenThisTurnRef.current = false;
      setToolsSeenThisTurn(false);
      setLoading(false);
    };

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
      const sessionId =
        event.sessionId?.trim() || conversationIdRef.current || "";
      if (!sessionId) return;

      const isActive = sessionId === conversationIdRef.current;
      const live = getLive(sessionId);

      if (isActive) {
        setEvents((prev) => [...prev, event]);
      }

      switch (event.type) {
        case "tool_call":
          if (live.streamingContent.trim()) {
            live.intermediateMessages = [
              ...live.intermediateMessages,
              live.streamingContent.trim(),
            ];
            live.streamingContent = "";
          }
          live.toolsSeen = true;
          live.loading = true;
          if (isActive) {
            addToolCalls([event.toolCall as ToolCall]);
            syncLiveToUi(sessionId);
          }
          break;
        case "tool_message":
          if (isActive) {
            load<ToolMessage>(JSON.stringify(event.toolMessage)).then((tm) =>
              addToolMessage(tm)
            );
          }
          break;
        case "intermediate_message": {
          const text = eventContentToString(event.content).trim();
          if (text) {
            live.intermediateMessages = [...live.intermediateMessages, text];
            live.loading = true;
          }
          if (isActive) syncLiveToUi(sessionId);
          break;
        }
        case "assistant_message": {
          live.streamingContent += eventContentToString(event.content);
          live.loading = true;
          if (isActive) syncLiveToUi(sessionId);
          break;
        }
        case "final_message": {
          const rawFinal = (
            live.streamingContent.trim() ||
            event.message ||
            ""
          ).trim();
          const { thinkingParts, answer } = splitModelThinkBlocks(rawFinal);
          const intermediate = [...live.intermediateMessages, ...thinkingParts];
          const assistantMessage: ChatMessage = {
            role: "assistant",
            content: answer || (thinkingParts.length === 0 ? rawFinal : ""),
            intermediate: intermediate.length > 0 ? intermediate : undefined,
          };

          liveTurnsRef.current.delete(sessionId);

          if (isActive) {
            setMessages((msgs) => [...msgs, assistantMessage]);
            clearUiStream();
          }
          break;
        }
      }
    });

    socket.on(
      "agent_error",
      (payload: { message?: string; sessionId?: string }) => {
        const sessionId =
          payload?.sessionId?.trim() || conversationIdRef.current || "";
        if (!sessionId) return;

        liveTurnsRef.current.delete(sessionId);

        if (sessionId !== conversationIdRef.current) return;

        const text =
          payload?.message?.trim() || "에이전트 처리 중 오류가 발생했습니다.";
        clearUiStream();
        setMessages((msgs) => [
          ...msgs,
          { role: "assistant", content: `오류: ${text}` },
        ]);
      }
    );

    socket.on("connect_error", () => {
      setConnected(false);
      setConnecting(false);
      setLoading(false);
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

      const live: LiveTurn = {
        streamingContent: "",
        intermediateMessages: [],
        toolsSeen: false,
        loading: true,
      };
      liveTurnsRef.current.set(activeSessionId, live);

      setEvents([]);
      streamingContentRef.current = "";
      setStreamingContent("");
      intermediateMessagesRef.current = [];
      setIntermediateMessages([]);
      toolsSeenThisTurnRef.current = false;
      setToolsSeenThisTurn(false);
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
        liveTurnsRef.current.delete(activeSessionId);
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
    [userId]
  );

  const clearCurrentConversation = useCallback(() => {
    const prev = conversationIdRef.current;
    if (prev) liveTurnsRef.current.delete(prev);
    conversationIdRef.current = null;
    setConversationId(null);
    setMessages([]);
    setEvents([]);
    resetToolCallStore();
    streamingContentRef.current = "";
    setStreamingContent("");
    intermediateMessagesRef.current = [];
    setIntermediateMessages([]);
    toolsSeenThisTurnRef.current = false;
    setToolsSeenThisTurn(false);
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
    intermediateMessagesRef.current = [];
    setIntermediateMessages([]);
    toolsSeenThisTurnRef.current = false;
    setToolsSeenThisTurn(false);
    setLoading(false);
  }, [resetToolCallStore, userId]);

  const resumeConversation = useCallback(
    async (sessionId: string) => {
      conversationIdRef.current = sessionId;
      setConversationId(sessionId);
      setEvents([]);
      resetToolCallStore();

      const live = liveTurnsRef.current.get(sessionId);
      if (live?.loading) {
        streamingContentRef.current = live.streamingContent;
        setStreamingContent(live.streamingContent);
        intermediateMessagesRef.current = live.intermediateMessages;
        setIntermediateMessages([...live.intermediateMessages]);
        toolsSeenThisTurnRef.current = live.toolsSeen;
        setToolsSeenThisTurn(live.toolsSeen);
        setLoading(true);
      } else {
        streamingContentRef.current = "";
        setStreamingContent("");
        intermediateMessagesRef.current = [];
        setIntermediateMessages([]);
        toolsSeenThisTurnRef.current = false;
        setToolsSeenThisTurn(false);
        setLoading(false);
      }

      try {
        const rows = await loadSessionMessages(sessionId);
        const hydrated = await hydrateSessionMessages(rows);
        // 전환 중에 다른 세션을 또 고르면 덮어쓰지 않음
        if (conversationIdRef.current !== sessionId) return;
        setMessages(hydrated.chatMessages);
        restoreToolCallStore(hydrated.toolCalls, hydrated.toolMessages);
      } catch {
        if (conversationIdRef.current !== sessionId) return;
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
        intermediateMessages,
        streamAsAnswer: toolsSeenThisTurn,
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
