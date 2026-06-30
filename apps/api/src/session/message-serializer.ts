import { load } from "@langchain/core/load";
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "langchain";

export async function serializeMessage(message: BaseMessage): Promise<string> {
  return JSON.stringify(message.toJSON());
}

function fallbackMessage(raw: string, role?: string): BaseMessage {
  if (raw === "[object Object]" || !raw.trim()) {
    return new AIMessage({ content: "" });
  }
  if (role === "human" || role === "user") {
    return new HumanMessage({ content: raw });
  }
  if (role === "tool") {
    return new ToolMessage({ content: raw, tool_call_id: "unknown" });
  }
  return new AIMessage({ content: raw });
}

export async function deserializeMessage(
  raw: string,
  role?: string
): Promise<BaseMessage> {
  try {
    return await load(raw);
  } catch {
    return fallbackMessage(raw, role);
  }
}

export async function serializeMessages(
  messages: BaseMessage[]
): Promise<string[]> {
  return Promise.all(messages.map((m) => serializeMessage(m)));
}

export async function deserializeMessages(
  rows: Array<{ content: string; role?: string }>
): Promise<BaseMessage[]> {
  return Promise.all(
    rows.map((r) => deserializeMessage(r.content, r.role))
  );
}
