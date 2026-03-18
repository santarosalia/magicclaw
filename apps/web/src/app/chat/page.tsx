"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import { ToolCallFlow } from "@/components/ToolCallFlow";
import { useAgentSocket } from "@/lib/useAgentSocket";

export default function ChatPage() {
  const [input, setInput] = useState("");
  const {
    connecting,
    connected,
    loading,
    streamingContent,
    messages,
    events,
    sendChat,
  } = useAgentSocket();

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 스트리밍/새 메시지 시 하단으로 스크롤
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    // 소켓으로 사용자 메시지만 전송 (히스토리는 백엔드 세션에서 관리)
    sendChat(text);
  }, [input, loading, sendChat]);

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
            {/* 스트리밍 중: 한 말풍선에서 중간 메시지가 실시간으로 갱신 */}
            {loading && streamingContent ? (
              <div className="mr-auto max-w-[85%] rounded-lg border border-primary/20 bg-card px-4 py-2 animate-in fade-in duration-200 animate-streaming-border">
                <div className="markdown-content prose prose-invert max-w-none animate-streaming-text">
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
                    {streamingContent}
                  </ReactMarkdown>
                </div>
              </div>
            ) : null}
            {(loading || connecting) && !streamingContent ? (
              <div className="flex items-center gap-2 rounded-lg border border-primary/20 px-3 py-2 text-muted-foreground text-sm animate-streaming-border">
                <span>
                  {connecting
                    ? "서버에 연결 중..."
                    : connected
                    ? "응답 중..."
                    : "연결이 끊어졌습니다."}
                </span>
              </div>
            ) : null}
            <div ref={messagesEndRef} />
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
            <ToolCallFlow className="w-full rounded-md flex-1" />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
