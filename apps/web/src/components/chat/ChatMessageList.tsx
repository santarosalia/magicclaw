"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import type { ChatMessage } from "@/lib/agent-socket-context";
import { IntermediateThoughts } from "@/components/chat/IntermediateThoughts";
import { splitModelThinkBlocks, toPlainThoughtText } from "@/lib/model-think";

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

  const { thinkingParts, answer } = splitModelThinkBlocks(message.content);
  const thoughts = [...(message.intermediate ?? []), ...thinkingParts].filter(
    Boolean
  );

  return (
    <div className="mr-auto max-w-[85%] space-y-2">
      {thoughts.length > 0 ? (
        <IntermediateThoughts items={thoughts} className="w-full" />
      ) : null}
      {answer ? (
        <div className="rounded-lg border bg-card px-4 py-2">
          <div className="markdown-content prose prose-invert max-w-none">
            <ReactMarkdown
              remarkPlugins={markdownPlugins.remark}
              rehypePlugins={markdownPlugins.rehype}
            >
              {answer}
            </ReactMarkdown>
          </div>
        </div>
      ) : null}
    </div>
  );
});

interface ChatMessageListProps {
  messages: ChatMessage[];
  streamingContent: string;
  intermediateMessages: string[];
  /** true: 스트림을 채팅 버블에 / false: 생각 과정 토글에 */
  streamAsAnswer: boolean;
  loading: boolean;
  connecting: boolean;
  connected: boolean;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
}

export const ChatMessageList = memo(function ChatMessageList({
  messages,
  streamingContent,
  intermediateMessages,
  streamAsAnswer,
  loading,
  connecting,
  connected,
  messagesEndRef,
}: ChatMessageListProps) {
  const streamSplit = splitModelThinkBlocks(streamingContent);
  const thoughtsLive = !loading
    ? ""
    : !streamAsAnswer
    ? toPlainThoughtText(streamingContent)
    : streamSplit.thinkingParts.join("\n\n");
  const answerLive =
    loading && streamAsAnswer && streamSplit.answer ? streamSplit.answer : "";

  return (
    <>
      {messages.length === 0 && !loading && (
        <p className="text-muted-foreground text-sm text-center py-8">
          메시지를 입력하면 새 대화가 자동으로 시작됩니다.
        </p>
      )}
      {messages.map((m, i) => (
        <ChatBubble
          key={`${i}-${m.role}-${m.content.slice(0, 32)}`}
          message={m}
        />
      ))}
      {loading && (intermediateMessages.length > 0 || thoughtsLive) ? (
        <IntermediateThoughts
          items={intermediateMessages}
          liveText={thoughtsLive || undefined}
        />
      ) : null}
      {answerLive ? (
        <div className="mr-auto max-w-[85%] rounded-lg border border-primary/20 bg-card px-4 py-2">
          <div className="markdown-content prose prose-invert max-w-none">
            <ReactMarkdown
              remarkPlugins={markdownPlugins.remark}
              rehypePlugins={markdownPlugins.rehype}
            >
              {answerLive}
            </ReactMarkdown>
          </div>
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
