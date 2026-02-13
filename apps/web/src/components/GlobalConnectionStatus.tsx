"use client";

import { useEffect, useState } from "react";
import {
  ConnectionStatus,
  type McpServerStatusItem,
} from "@/components/ConnectionStatus";
import { useAgentSocket } from "@/lib/agent-socket-context";
import { useLlmStatus } from "@/lib/llm-status-context";

type McpStatus = "loading" | "ok" | "partial" | "error" | "none";

function deriveMcpStatus(servers: McpServerStatusItem[]): McpStatus {
  if (servers.length === 0) return "none";
  const errors = servers.filter((s) => s.status === "error").length;
  if (errors === 0) return "ok";
  if (errors === servers.length) return "error";
  return "partial";
}

export function GlobalConnectionStatus() {
  const { connecting, connected } = useAgentSocket();
  const { llmState } = useLlmStatus();
  const [mcpServers, setMcpServers] = useState<McpServerStatusItem[] | null>(
    null
  );

  useEffect(() => {
    const apiOrigin =
      process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://localhost:4000";
    const url = apiOrigin.replace(/\/$/, "") + "/mcp/servers/status";
    fetch(url)
      .then((res) => (res.ok ? res.json() : []))
      .then((data: McpServerStatusItem[]) => setMcpServers(Array.isArray(data) ? data : []))
      .catch(() => setMcpServers([]));
  }, []);

  const mcpStatus: McpStatus =
    mcpServers === null ? "loading" : deriveMcpStatus(mcpServers);

  return (
    <div className="fixed top-4 right-4 z-50">
      <ConnectionStatus
        socketStatus={
          connecting ? "connecting" : connected ? "connected" : "disconnected"
        }
        llmStatus={llmState.status}
        llmError={llmState.error}
        mcpStatus={mcpStatus}
        mcpServers={mcpServers ?? []}
      />
    </div>
  );
}
