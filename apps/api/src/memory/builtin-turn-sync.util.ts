import { ToolMessage } from "langchain";
import type { BaseMessage } from "langchain";
import { getMessageContentAsString } from "../agent/agent.types.js";

export function turnWroteBuiltinMemory(messages: BaseMessage[]): boolean {
  for (const msg of messages) {
    if (!(msg instanceof ToolMessage) || msg.name !== "memory") continue;
    const raw = getMessageContentAsString(msg);
    try {
      const parsed = JSON.parse(raw) as { success?: boolean };
      if (parsed.success) return true;
    } catch {
      // ignore malformed tool output
    }
  }
  return false;
}
