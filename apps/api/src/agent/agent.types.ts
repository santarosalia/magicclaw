import type { ContentBlock } from "langchain";
import type { ToolCall, ToolMessage, BaseMessage } from "langchain";
import type { UserScope } from "../user/user-scope.js";

export interface AgentChatOptions {
  messagesLc: BaseMessage[];
  sessionId: string;
  channel: AgentChannel;
  userScope: UserScope;
  memoryContext?: string;
  systemMemoryBlock?: string;
  contextFilesBlock?: string;
  skillsIndexBlock?: string;
  /** Active LLM context window (tokens); budget uses this unless env overrides. */
  contextWindow?: number;
  refreshMemoryBlocks?: () => {
    systemMemoryBlock: string;
    memoryContext: string;
  };
}

export type AgentEvent =
  | { type: "tool_call"; toolCall: ToolCall }
  | { type: "tool_result"; name: string; output: string }
  | { type: "assistant_message"; content: string | ContentBlock[] }
  /** 도구 호출 전·사이 서술. UI에서는 접힌 토글로만 표시 */
  | { type: "intermediate_message"; content: string }
  | { type: "tool_message"; toolMessage: ToolMessage }
  | { type: "final_message"; message: string };

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
