"use client";

import { memo, useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";

interface IntermediateThoughtsProps {
  items: string[];
  /** 진행 중인 스트림 텍스트 (생각 과정 실시간 표시) */
  liveText?: string;
  className?: string;
}

export const IntermediateThoughts = memo(function IntermediateThoughts({
  items,
  liveText,
  className,
}: IntermediateThoughtsProps) {
  const cleaned = items.map((t) => t.trim()).filter(Boolean);
  const live = liveText?.trim() ?? "";
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (live) setOpen(true);
  }, [live]);

  if (cleaned.length === 0 && !live) return null;

  const stepLabel =
    cleaned.length + (live ? 1 : 0) > 0
      ? `생각 과정 ${cleaned.length + (live ? 1 : 0)}단계`
      : "생각 과정";

  return (
    <div className={className ?? "mr-auto max-w-[85%]"}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        aria-expanded={open}
      >
        <ChevronRight
          className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
        />
        <span>{stepLabel}</span>
        {live ? (
          <span className="text-[10px] text-primary/80 animate-pulse">작성 중</span>
        ) : null}
      </button>
      {open ? (
        <div className="mt-1.5 space-y-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2">
          {cleaned.map((text, i) => (
            <p
              key={`${i}-${text.slice(0, 24)}`}
              className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed"
            >
              {text}
            </p>
          ))}
          {live ? (
            <p className="text-xs text-muted-foreground/90 whitespace-pre-wrap leading-relaxed">
              {live}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});
