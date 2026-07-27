"use client";

import { memo, useState } from "react";
import { ChevronRight } from "lucide-react";

interface IntermediateThoughtsProps {
  items: string[];
  className?: string;
}

export const IntermediateThoughts = memo(function IntermediateThoughts({
  items,
  className,
}: IntermediateThoughtsProps) {
  const [open, setOpen] = useState(false);
  const cleaned = items.map((t) => t.trim()).filter(Boolean);
  if (cleaned.length === 0) return null;

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
        <span>생각 과정 {cleaned.length}단계</span>
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
        </div>
      ) : null}
    </div>
  );
});
