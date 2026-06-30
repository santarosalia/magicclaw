"use client";

import { memo, useCallback, useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface ChatComposerProps {
  disabled: boolean;
  onSend: (text: string) => void | Promise<void>;
}

/** 입력 상태를 이 컴포넌트 안에 격리 — 타이핑 시 메시지 목록/ReactFlow 재렌더 방지 */
export const ChatComposer = memo(function ChatComposer({
  disabled,
  onSend,
}: ChatComposerProps) {
  const [input, setInput] = useState("");

  const submit = useCallback(async () => {
    const text = input.trim();
    if (!text || disabled) return;
    setInput("");
    await onSend(text);
  }, [disabled, input, onSend]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="p-4 border-t flex gap-2"
    >
      <Input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="메시지 입력..."
        disabled={disabled}
        className="flex-1"
      />
      <Button type="submit" disabled={disabled || !input.trim()} size="icon">
        <Send className="h-4 w-4" />
      </Button>
    </form>
  );
});
