"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { io, type Socket } from "socket.io-client";

type AgentSocketEvent =
  | {
      type: "tool_call";
      name: string;
      args: Record<string, unknown>;
    }
  | {
      type: "tool_result";
      name: string;
      output: string;
    }
  | {
      type: "final_message";
      message: string;
      toolCallsUsed: number;
      toolCalls: { name: string; args: Record<string, unknown> }[];
    };

type ChatMessage = { role: string; content: string };

export function useAgentSocket() {
  const socketRef = useRef<Socket | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<AgentSocketEvent[]>([]);

  useEffect(() => {
    setConnecting(true);
    // API 서버(Nest)는 기본적으로 4000 포트에서 동작하므로,
    // 웹 앱(3000 포트)의 origin이 아니라 API origin으로 소켓을 연결한다.
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
      setEvents((prev) => [...prev, event]);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  const sendChat = useCallback((messages: ChatMessage[]) => {
    if (!socketRef.current) return;
    setEvents([]);
    socketRef.current.emit("chat", { messages });
  }, []);

  return {
    connecting,
    connected,
    events,
    sendChat,
  };
}

