import type { ContentBlock } from "langchain";
import type { ToolCall, ToolMessage, BaseMessage } from "langchain";

export interface AgentChatOptions {
  messagesLc: BaseMessage[];
  sessionId: string;
  channel: AgentChannel;
}

export type AgentEvent =
  | { type: "plan"; content: string }
  | { type: "tool_call"; toolCall: ToolCall }
  | { type: "tool_result"; name: string; output: string }
  | { type: "assistant_message"; content: string | ContentBlock[] }
  | { type: "tool_message"; toolMessage: ToolMessage }
  | { type: "final_message"; message: string };

export function parsePlanSteps(planText: string): string[] {
  const trimmed = planText.trim();
  if (!trimmed) return [];
  const lines = trimmed
    .split(/\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const steps = lines.map((line) =>
    line.replace(/^\s*(\d+[.)]\s*|[-*]\s+)/i, "").trim()
  );
  return steps.length > 0 ? steps : [trimmed];
}

export function getMessageContentAsString(msg: BaseMessage): string {
  const c = msg.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return (c as { type?: string; text?: string }[])
      .filter((x) => x.type === "text" && typeof x.text === "string")
      .map((x) => x.text)
      .join("");
  }
  return "";
}

export enum AgentChannel {
  WEB = "web",
  TELEGRAM = "telegram",
  API = "api",
}
