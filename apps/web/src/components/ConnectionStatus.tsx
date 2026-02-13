"use client";

import { Wifi, WifiOff, Loader2, Brain, Server } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type SocketStatus = "connecting" | "connected" | "disconnected";
type LlmStatus = "configured" | "not_configured" | "loading" | "error";

export interface McpServerStatusItem {
  id: string;
  name: string;
  status: "ok" | "error";
  error?: string;
}

type McpStatus = "loading" | "ok" | "partial" | "error" | "none";

interface ConnectionStatusProps {
  socketStatus: SocketStatus;
  llmStatus: LlmStatus;
  llmError?: string;
  mcpStatus?: McpStatus;
  mcpServers?: McpServerStatusItem[];
  className?: string;
}

export function ConnectionStatus({
  socketStatus,
  llmStatus,
  llmError,
  mcpStatus = "none",
  mcpServers = [],
  className,
}: ConnectionStatusProps) {
  const socketLabel =
    socketStatus === "connecting"
      ? "연결 중..."
      : socketStatus === "connected"
        ? "API 연결됨"
        : "API 끊김";

  const llmLabel =
    llmStatus === "loading"
      ? "LLM 확인 중..."
      : llmStatus === "configured"
        ? "LLM 연결됨"
        : llmStatus === "error"
          ? "LLM 오류"
          : "LLM 미설정";

  const errorServers = mcpServers.filter((s) => s.status === "error");
  const mcpTooltip =
    errorServers.length > 0
      ? errorServers
          .map((s) => `${s.name}: ${s.error ?? "오류"}`)
          .join("\n")
      : undefined;

  const mcpLabel =
    mcpStatus === "loading"
      ? "MCP 확인 중..."
      : mcpStatus === "none"
        ? "MCP 없음"
        : mcpStatus === "ok"
          ? `MCP ${mcpServers.length}개 정상`
          : mcpStatus === "partial"
            ? `MCP ${mcpServers.length - errorServers.length}개 정상 / ${errorServers.length}개 오류`
            : "MCP 오류";

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Badge
        variant="outline"
        className={cn(
          "gap-1.5 font-normal",
          socketStatus === "connected" &&
            "border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
          socketStatus === "connecting" &&
            "border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400",
          socketStatus === "disconnected" &&
            "border-red-500/50 bg-red-500/10 text-red-600 dark:text-red-400"
        )}
      >
        {socketStatus === "connecting" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : socketStatus === "connected" ? (
          <Wifi className="h-3.5 w-3.5" />
        ) : (
          <WifiOff className="h-3.5 w-3.5" />
        )}
        <span>{socketLabel}</span>
      </Badge>
      <Badge
        variant="outline"
        title={llmError}
        className={cn(
          "gap-1.5 font-normal",
          llmStatus === "configured" &&
            "border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
          llmStatus === "loading" &&
            "border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400",
          (llmStatus === "not_configured" || llmStatus === "error") &&
            "border-red-500/50 bg-red-500/10 text-red-600 dark:text-red-400 cursor-help"
        )}
      >
        {llmStatus === "loading" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Brain className="h-3.5 w-3.5" />
        )}
        <span>{llmLabel}</span>
      </Badge>
      <Badge
        variant="outline"
        title={mcpTooltip}
        className={cn(
          "gap-1.5 font-normal cursor-help",
          mcpStatus === "ok" &&
            "border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
          (mcpStatus === "loading" || mcpStatus === "none") &&
            "border-muted-foreground/50 bg-muted/30 text-muted-foreground",
          (mcpStatus === "partial" || mcpStatus === "error") &&
            "border-red-500/50 bg-red-500/10 text-red-600 dark:text-red-400"
        )}
      >
        {mcpStatus === "loading" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Server className="h-3.5 w-3.5" />
        )}
        <span>{mcpLabel}</span>
      </Badge>
    </div>
  );
}
