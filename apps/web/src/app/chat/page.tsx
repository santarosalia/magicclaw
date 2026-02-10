"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import { ToolCallFlow, type ToolCallEntry } from "@/components/ToolCallFlow";

type Message = { role: "user" | "assistant"; content: string };

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  /** 채팅 중 발생한 tool call 목록 (이름 + args) 캐시 → React Flow로 렌더 */
  const [toolCallsCache, setToolCallsCache] = useState<ToolCallEntry[]>([]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setLoading(true);
    try {
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, { role: "user", content: text }].map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as {
        message: string;
        toolCallsUsed?: number;
        toolCalls?: ToolCallEntry[];
      };
      if (data.toolCalls?.length) {
        setToolCallsCache((prev) => [...prev, ...data.toolCalls!]);
      }
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.message,
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "오류: " + (err instanceof Error ? err.message : String(err)),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages]);

  return (
    <main className="h-screen flex flex-col p-6">
      <div className="flex items-center gap-2 mb-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="text-xl font-semibold">채팅</h1>
      </div>
      <div className="flex flex-1 gap-4 min-h-0">
        <Card className="flex flex-col min-h-0 flex-2">
          <CardContent className="flex-1 overflow-auto p-4 space-y-4">
            {messages.length === 0 && (
              <p className="text-muted-foreground text-sm text-center py-8">
                메시지가 없습니다.
              </p>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={
                  m.role === "user"
                    ? "ml-auto max-w-[85%] rounded-lg bg-primary text-primary-foreground px-4 py-2"
                    : "mr-auto max-w-[85%] rounded-lg border bg-card px-4 py-2"
                }
              >
                {m.role === "user" ? (
                  <p className="text-sm whitespace-pre-wrap">{m.content}</p>
                ) : (
                  <div className="markdown-content prose prose-invert max-w-none">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      rehypePlugins={[rehypeRaw, rehypeHighlight]}
                      components={{
                        code: ({ node, className, children, ...props }) => {
                          const match = /language-(\w+)/.exec(className || "");
                          return match ? (
                            <code className={className} {...props}>
                              {children}
                            </code>
                          ) : (
                            <code className={className} {...props}>
                              {children}
                            </code>
                          );
                        },
                      }}
                    >
                      {m.content}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <p className="text-muted-foreground text-sm">응답 중...</p>
            )}
          </CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
            className="p-4 border-t flex gap-2"
          >
            <Input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="메시지 입력..."
              disabled={loading}
              className="flex-1"
            />
            <Button
              type="submit"
              disabled={loading || !input.trim()}
              size="icon"
            >
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </Card>

        <Card className="overflow-hidden flex-1 h-full">
          <CardContent className="p-2 h-full flex flex-col">
            <p className="text-xs text-muted-foreground mb-2 px-1">
              Tool calls
            </p>
            <ToolCallFlow
              toolCalls={toolCallsCache}
              className="w-full rounded-md flex flex-1"
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
