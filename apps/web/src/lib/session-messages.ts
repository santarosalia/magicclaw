import { load } from "@langchain/core/load";
import {
  AIMessage,
  HumanMessage,
  ToolMessage,
  type BaseMessage,
  type ToolCall,
} from "langchain";
import type { ChatMessage } from "./agent-socket-context";
import {
  splitModelThinkBlocks,
  toPlainThoughtText,
} from "./model-think";

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

/**
 * Rebuild chat bubbles like the live UI:
 * - AI text before/with tool calls → intermediate (생각 과정)
 * - last AI without tool calls in a turn → answer (think tags split out)
 */
export function foldAssistantTurn(
  pendingIntermediate: string[],
  finalText: string
): ChatMessage {
  const { thinkingParts, answer } = splitModelThinkBlocks(finalText);
  const intermediate = [
    ...pendingIntermediate,
    ...thinkingParts,
  ].filter(Boolean);

  return {
    role: "assistant",
    content: answer || (thinkingParts.length === 0 ? finalText : ""),
    intermediate: intermediate.length > 0 ? intermediate : undefined,
  };
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

  let pendingIntermediate: string[] = [];
  /** 도구 없는 AI 텍스트 — 이후 또 오면 이전 것은 생각 과정으로 밀어 넣음 */
  let pendingAnswer: string | null = null;

  const flushAssistant = () => {
    if (pendingAnswer !== null) {
      chatMessages.push(foldAssistantTurn(pendingIntermediate, pendingAnswer));
      pendingIntermediate = [];
      pendingAnswer = null;
      return;
    }
    if (pendingIntermediate.length > 0) {
      chatMessages.push({
        role: "assistant",
        content: "",
        intermediate: [...pendingIntermediate],
      });
      pendingIntermediate = [];
    }
  };

  for (const row of rows) {
    const message = await deserializeRow(row);
    const type = message.getType();

    if (type === "human") {
      flushAssistant();
      chatMessages.push({ role: "user", content: contentAsString(message) });
      continue;
    }

    if (type === "ai") {
      const ai = message as AIMessage;
      if (ai.tool_calls?.length) {
        toolCalls.push(...(ai.tool_calls as ToolCall[]));
      }

      const text = contentAsString(ai).trim();
      if (!text) continue;

      if (ai.tool_calls?.length) {
        // 도구 라운드 서술 → 생각 과정
        if (pendingAnswer !== null) {
          const plain = toPlainThoughtText(pendingAnswer);
          if (plain) pendingIntermediate.push(plain);
          pendingAnswer = null;
        }
        const plain = toPlainThoughtText(text);
        if (plain) pendingIntermediate.push(plain);
        continue;
      }

      // 최종 후보; 같은 턴에 또 오면 이전 후보를 생각 과정으로
      if (pendingAnswer !== null) {
        const plain = toPlainThoughtText(pendingAnswer);
        if (plain) pendingIntermediate.push(plain);
      }
      pendingAnswer = text;
      continue;
    }

    if (type === "tool" && message instanceof ToolMessage) {
      toolMessages.push(message);
    }
  }

  flushAssistant();

  return { chatMessages, toolCalls, toolMessages };
}
