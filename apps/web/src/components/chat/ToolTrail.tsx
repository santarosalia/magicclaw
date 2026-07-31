"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useToolCallStore, type ToolTrailEntry } from "@/stores/tool-call-store";
import {
  formatDurationSeconds,
  formatToolLabel,
} from "@/lib/tool-trail";
import { cn } from "@/lib/utils";

function TrailRow({ entry, now }: { entry: ToolTrailEntry; now: number }) {
  const label = formatToolLabel(entry.name, entry.context);
  const elapsedMs =
    entry.status === "running"
      ? now - entry.startedAt
      : (entry.endedAt ?? now) - entry.startedAt;
  const duration =
    entry.status === "running" || elapsedMs >= 100
      ? formatDurationSeconds(elapsedMs)
      : null;

  return (
    <li className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 font-mono text-xs leading-relaxed">
      <span className="inline-flex items-center gap-1 text-foreground">
        {entry.status === "running" ? (
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />
        ) : null}
        <span className="break-all">{label}</span>
      </span>
      {duration ? (
        <span className="text-muted-foreground shrink-0">({duration})</span>
      ) : null}
      {entry.summary ? (
        <span className="text-muted-foreground break-all">
          :: {entry.summary}
        </span>
      ) : null}
      {entry.status === "ok" ? (
        <span className="text-muted-foreground shrink-0">✓</span>
      ) : null}
      {entry.status === "error" ? (
        <span className="text-destructive shrink-0">✗</span>
      ) : null}
    </li>
  );
}

export function ToolTrail({ className }: { className?: string }) {
  const trail = useToolCallStore((s) => s.trail);
  const [now, setNow] = useState(() => Date.now());
  const hasRunning = trail.some((e) => e.status === "running");

  useEffect(() => {
    if (!hasRunning) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [hasRunning]);

  if (!trail.length) {
    return (
      <p className={cn("text-sm text-muted-foreground", className)}>
        툴 호출이 없습니다.
      </p>
    );
  }

  return (
    <div className={cn("flex flex-col min-h-0 gap-2", className)}>
      <div className="text-sm font-medium text-foreground">Tools</div>
      <ul className="space-y-1.5 overflow-y-auto min-h-0 pr-1">
        {trail.map((entry) => (
          <TrailRow key={entry.id} entry={entry} now={now} />
        ))}
      </ul>
    </div>
  );
}
