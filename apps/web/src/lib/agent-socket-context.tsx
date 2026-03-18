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
  connecting: boolean;
  connected: boolean;
  events: AgentSocketEvent[];
  loading: boolean;
  streamingContent: string;
  messages: ChatMessage[];
  /** 현재 사용자 입력 한 줄만 전송. 히스토리는 백엔드 세션에서 관리. */
  sendChat: (userMessage: string, model?: string) => void;
}

const AgentSocketContext = createContext<AgentSocketValue | null>(null);

export function AgentSocketProvider({ children }: { children: ReactNode }) {
  const socketRef = useRef<Socket | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<AgentSocketEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const streamingContentRef = useRef("");
  const {
    addToolCalls,
    addToolMessage,
    reset: resetToolCallStore,
  } = useToolCallStore();

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

    socket.on("agent_event", (event: AgentSocketEvent) => {
      // 이벤트 로그는 그대로 누적
      setEvents((prev) => [...prev, event]);

      // 단일 이벤트 단위로 툴콜/툴메시지/스트리밍/로딩 상태 처리
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
          // 최종 assistant 메시지를 고정 말풍선으로 messages에 추가
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
  }, []);

  const sendChat = useCallback(
    (userMessage: string, model?: string) => {
      if (!socketRef.current) {
        throw new Error("소켓이 연결되지 않았습니다.");
      }
      setEvents([]);
      streamingContentRef.current = "";
      setStreamingContent("");
      setLoading(true);
      // 사용자 메시지는 여기서 messages에 추가
      setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
      try {
        socketRef.current.emit("chat", { userMessage, model });
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
    [resetToolCallStore]
  );

  return (
    <AgentSocketContext.Provider
      value={{
        connecting,
        connected,
        events,
        loading,
        streamingContent,
        messages,
        sendChat,
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
