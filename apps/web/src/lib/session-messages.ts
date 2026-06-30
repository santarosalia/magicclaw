import { load } from "@langchain/core/load";
import {
  AIMessage,
  HumanMessage,
  ToolMessage,
  type BaseMessage,
  type ToolCall,
} from "langchain";
import type { ChatMessage } from "./agent-socket-context";

export interface SessionMessageRow {
  role: string;
  content: string;
  data?: unknown;
}

function contentAsString(message: BaseMessage): string {
  const c = message.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .filter((x): x is { type: string; text: string } => x.type === "text")
      .map((x) => x.text)
      .join("");
  }
  return "";
}

async function deserializeRow(row: SessionMessageRow): Promise<BaseMessage> {
  if (row.data) {
    const json =
      typeof row.data === "string" ? row.data : JSON.stringify(row.data);
    return load(json);
  }
  if (row.role === "human" || row.role === "user") {
    return new HumanMessage({ content: row.content });
  }
  if (row.role === "tool") {
    return new ToolMessage({ content: row.content, tool_call_id: "unknown" });
  }
  return new AIMessage({ content: row.content });
}

export async function hydrateSessionMessages(
  rows: SessionMessageRow[]
): Promise<{
  chatMessages: ChatMessage[];
  toolCalls: ToolCall[];
  toolMessages: ToolMessage[];
}> {
  const chatMessages: ChatMessage[] = [];
  const toolCalls: ToolCall[] = [];
  const toolMessages: ToolMessage[] = [];

  for (const row of rows) {
    const message = await deserializeRow(row);
    const type = message.getType();

    if (type === "human") {
      chatMessages.push({ role: "user", content: contentAsString(message) });
      continue;
    }

    if (type === "ai") {
      const ai = message as AIMessage;
      if (ai.tool_calls?.length) {
        toolCalls.push(...(ai.tool_calls as ToolCall[]));
      }
      const text = contentAsString(ai);
      if (text.trim()) {
        chatMessages.push({ role: "assistant", content: text });
      }
      continue;
    }

    if (type === "tool" && message instanceof ToolMessage) {
      toolMessages.push(message);
    }
  }

  return { chatMessages, toolCalls, toolMessages };
}
