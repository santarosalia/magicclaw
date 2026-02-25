"use client";

import { ToolCall } from "langchain";
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

export type AgentSocketEvent =
  | {
      type: "tool_call";
      toolCall: ToolCall;
    }
  | {
      type: "tool_result";
      name: string;
      output: string;
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

type ChatMessage = { role: string; content: string };

interface AgentSocketValue {
  connecting: boolean;
  connected: boolean;
  events: AgentSocketEvent[];
  sendChat: (messages: ChatMessage[]) => void;
}

const AgentSocketContext = createContext<AgentSocketValue | null>(null);

export function AgentSocketProvider({ children }: { children: ReactNode }) {
  const socketRef = useRef<Socket | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<AgentSocketEvent[]>([]);

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

  return (
    <AgentSocketContext.Provider
      value={{ connecting, connected, events, sendChat }}
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
