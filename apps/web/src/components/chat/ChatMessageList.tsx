"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import type { ChatMessage } from "@/lib/agent-socket-context";

const markdownPlugins = {
  remark: [remarkGfm],
  rehype: [rehypeRaw, rehypeHighlight],
};

const ChatBubble = memo(function ChatBubble({
  message,
}: {
  message: ChatMessage;
}) {
  if (message.role === "user") {
    return (
      <div className="ml-auto max-w-[85%] rounded-lg bg-primary text-primary-foreground px-4 py-2">
        <p className="text-sm whitespace-pre-wrap">{message.content}</p>
      </div>
    );
  }

  return (
    <div className="mr-auto max-w-[85%] rounded-lg border bg-card px-4 py-2">
      <div className="markdown-content prose prose-invert max-w-none">
        <ReactMarkdown
          remarkPlugins={markdownPlugins.remark}
          rehypePlugins={markdownPlugins.rehype}
        >
          {message.content}
        </ReactMarkdown>
      </div>
    </div>
  );
});

interface ChatMessageListProps {
  messages: ChatMessage[];
  streamingContent: string;
  loading: boolean;
  connecting: boolean;
  connected: boolean;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
}

export const ChatMessageList = memo(function ChatMessageList({
  messages,
  streamingContent,
  loading,
  connecting,
  connected,
  messagesEndRef,
}: ChatMessageListProps) {
  return (
    <>
      {messages.length === 0 && (
        <p className="text-muted-foreground text-sm text-center py-8">
          메시지를 입력하면 새 대화가 자동으로 시작됩니다.
        </p>
      )}
      {messages.map((m, i) => (
        <ChatBubble key={`${i}-${m.role}-${m.content.slice(0, 32)}`} message={m} />
      ))}
      {loading && streamingContent ? (
        <div className="mr-auto max-w-[85%] rounded-lg border border-primary/20 bg-card px-4 py-2">
          <p className="text-sm whitespace-pre-wrap">{streamingContent}</p>
        </div>
      ) : null}
      {(loading || connecting) && !streamingContent ? (
        <div className="flex items-center gap-2 rounded-lg border border-primary/20 px-3 py-2 text-muted-foreground text-sm">
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
    </>
  );
});
