import type { StructuredToolInterface } from "@langchain/core/tools";
import {
  AIMessage,
  HumanMessage,
  ToolMessage,
  type BaseMessage,
} from "langchain";
import { getMessageContentAsString } from "./agent.types.js";

export interface ContextBudgetConfig {
  contextWindow: number;
  outputReserve: number;
  toolSchemaReserve: number;
  safetyMargin: number;
}

export function getContextBudgetConfig(options?: {
  contextWindow?: number;
}): ContextBudgetConfig {
  return {
    contextWindow: resolveContextWindow(options?.contextWindow),
    outputReserve: Number(process.env.AGENT_OUTPUT_RESERVE ?? 4096),
    toolSchemaReserve: Number(process.env.AGENT_TOOL_SCHEMA_RESERVE ?? 8192),
    safetyMargin: Number(process.env.AGENT_CONTEXT_SAFETY_MARGIN ?? 2048),
  };
}

function resolveContextWindow(configWindow?: number): number {
  const envRaw = process.env.AGENT_CONTEXT_WINDOW;
  if (envRaw !== undefined && envRaw !== "") {
    const fromEnv = Number(envRaw);
    if (Number.isFinite(fromEnv) && fromEnv > 0) return Math.floor(fromEnv);
  }
  if (
    configWindow !== undefined &&
    Number.isFinite(configWindow) &&
    configWindow > 0
  ) {
    return Math.floor(configWindow);
  }
  return 65536;
}

const TRUNCATION_SUFFIX = "\n...[truncated for context limit]";

/** Reserve for the fixed agent system prompt (not memory blocks). */
export const BASE_SYSTEM_PROMPT_TOKEN_RESERVE = 800;

/** Conservative token estimate with fudge factor for tokenizer drift. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil((text.length / 2) * 1.1);
}

export function estimateMessageTokens(message: BaseMessage): number {
  let tokens = estimateTokens(getMessageContentAsString(message));
  // AIMessageChunk is NOT instanceof AIMessage (extends BaseMessageChunk).
  if (AIMessage.isInstance(message)) {
    for (const toolCall of message.tool_calls ?? []) {
      tokens += estimateTokens(JSON.stringify(toolCall));
    }
  }
  if (message instanceof ToolMessage && message.name) {
    tokens += estimateTokens(message.name);
  }
  return tokens + 8;
}

export function estimateMessagesTokens(messages: BaseMessage[]): number {
  return messages.reduce(
    (sum, message) => sum + estimateMessageTokens(message),
    0
  );
}

export function estimateToolsTokens(tools: StructuredToolInterface[]): number {
  let total = 256;
  for (const tool of tools) {
    total += estimateTokens(tool.name);
    total += estimateTokens(tool.description ?? "");
    try {
      const schema = (tool as { schema?: unknown }).schema;
      if (schema) total += estimateTokens(JSON.stringify(schema));
    } catch {
      total += 512;
    }
  }
  return total;
}

function leadingDropCount(messages: BaseMessage[]): number {
  if (messages.length === 0) return 0;
  const first = messages[0];
  if (AIMessage.isInstance(first) && first.tool_calls?.length) {
    const ids = new Set(
      first.tool_calls
        .map((toolCall) => toolCall.id)
        .filter((id): id is string => Boolean(id))
    );
    let count = 1;
    while (count < messages.length) {
      const next = messages[count];
      if (next instanceof ToolMessage && ids.has(next.tool_call_id)) {
        count++;
        continue;
      }
      break;
    }
    return count;
  }
  if (first instanceof ToolMessage) return 1;
  return 1;
}

function cloneWithContent(message: BaseMessage, content: string): BaseMessage {
  if (message instanceof HumanMessage) {
    return new HumanMessage({ content });
  }
  if (message instanceof ToolMessage) {
    return new ToolMessage({
      content,
      tool_call_id: message.tool_call_id,
      name: message.name,
    });
  }
  if (AIMessage.isInstance(message)) {
    return new AIMessage({
      content,
      tool_calls: message.tool_calls,
      invalid_tool_calls: message.invalid_tool_calls,
      additional_kwargs: message.additional_kwargs,
      response_metadata: message.response_metadata,
      id: message.id,
    });
  }
  return message;
}

function truncateContent(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  if (maxChars <= TRUNCATION_SUFFIX.length + 32) {
    return content.slice(0, Math.max(0, maxChars));
  }
  return (
    content.slice(0, maxChars - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX
  );
}

function truncateMessageToChars(
  message: BaseMessage,
  maxChars: number
): BaseMessage {
  const content = getMessageContentAsString(message);
  if (content.length <= maxChars) return message;
  return cloneWithContent(message, truncateContent(content, maxChars));
}

export function trimMessagesToTokenBudget(
  messages: BaseMessage[],
  tokenBudget: number
): BaseMessage[] {
  if (tokenBudget <= 0 || messages.length === 0) return messages;
  let trimmed = [...messages];
  while (trimmed.length > 1 && estimateMessagesTokens(trimmed) > tokenBudget) {
    trimmed = trimmed.slice(leadingDropCount(trimmed));
  }
  return trimmed;
}

export function shrinkMessagesToBudget(
  messages: BaseMessage[],
  tokenBudget: number
): BaseMessage[] {
  let result = repairToolCallPairs(truncatePass([...messages], tokenBudget));
  if (estimateMessagesTokens(result) <= tokenBudget) return result;

  result = repairToolCallPairs(trimMessagesToTokenBudget(result, tokenBudget));
  if (estimateMessagesTokens(result) <= tokenBudget) return result;

  return repairToolCallPairs(truncatePass(result, tokenBudget));
}

/**
 * Ensure every AIMessage.tool_calls id has a following ToolMessage, and drop
 * orphan ToolMessages. Prevents OpenAI 400 "No tool output found for function call".
 *
 * Also strips Responses API raw `response_metadata.output` so LangChain rebuilds
 * function_call items from tool_calls + ToolMessages (raw output replay can leave
 * unpaired function_calls when history was trimmed or stubs were inserted).
 *
 * Must use AIMessage.isInstance — streamed turns are AIMessageChunk, and
 * `chunk instanceof AIMessage` is false in @langchain/core 1.x.
 */
export function repairToolCallPairs(messages: BaseMessage[]): BaseMessage[] {
  const pending = new Map<
    string,
    { name?: string; insertAfterIndex: number }
  >();
  const satisfied = new Set<string>();
  const result: BaseMessage[] = [];

  for (const message of messages) {
    if (AIMessage.isInstance(message) && message.tool_calls?.length) {
      result.push(stripResponsesRawOutput(message));
      const insertAfter = result.length - 1;
      for (const toolCall of message.tool_calls) {
        const id = toolCall.id?.trim();
        if (!id) continue;
        pending.set(id, { name: toolCall.name, insertAfterIndex: insertAfter });
      }
      continue;
    }

    if (message instanceof ToolMessage) {
      const id = message.tool_call_id?.trim();
      if (!id || (!pending.has(id) && !satisfied.has(id))) {
        // Orphan tool output — drop.
        continue;
      }
      pending.delete(id);
      satisfied.add(id);
      result.push(message);
      continue;
    }

    // Flush stubs for any still-pending tool calls before a non-tool message.
    flushMissingToolOutputs(result, pending, satisfied);
    result.push(message);
  }

  flushMissingToolOutputs(result, pending, satisfied);
  return result;
}

function stripResponsesRawOutput(message: AIMessage): AIMessage {
  const meta = message.response_metadata as
    | Record<string, unknown>
    | undefined;
  const response_metadata =
    meta && "output" in meta
      ? (() => {
          const { output: _output, ...rest } = meta;
          return rest;
        })()
      : meta;
  // Always normalize to AIMessage — streamed turns are AIMessageChunk.
  return new AIMessage({
    content: message.content,
    tool_calls: message.tool_calls,
    invalid_tool_calls: message.invalid_tool_calls,
    additional_kwargs: message.additional_kwargs,
    response_metadata,
    id: message.id,
  });
}

function flushMissingToolOutputs(
  result: BaseMessage[],
  pending: Map<string, { name?: string; insertAfterIndex: number }>,
  satisfied: Set<string>
): void {
  if (pending.size === 0) return;
  // Insert stubs in stable order right after their AI message group.
  // Simpler approach: append stubs at current end (after the AI + any
  // existing tools) which is correct when we flush before the next human/ai.
  const missing = [...pending.entries()];
  pending.clear();
  for (const [id, meta] of missing) {
    if (satisfied.has(id)) continue;
    result.push(
      new ToolMessage({
        content: "[tool result unavailable — omitted from context]",
        tool_call_id: id,
        name: meta.name,
      })
    );
    satisfied.add(id);
  }
}

function truncatePass(
  messages: BaseMessage[],
  tokenBudget: number
): BaseMessage[] {
  const result = [...messages];
  for (let pass = 0; pass < 12; pass++) {
    if (estimateMessagesTokens(result) <= tokenBudget) return result;

    let changed = false;
    for (let i = 0; i < result.length; i++) {
      const message = result[i];
      const isLast = i === result.length - 1;
      if (
        !(message instanceof ToolMessage || AIMessage.isInstance(message)) &&
        !(isLast && message instanceof HumanMessage)
      ) {
        continue;
      }

      const content = getMessageContentAsString(message);
      const minChars = isLast ? 400 : 120;
      if (content.length <= minChars) continue;

      const nextLen = Math.max(minChars, Math.floor(content.length * 0.65));
      result[i] = truncateMessageToChars(message, nextLen);
      changed = true;
      if (estimateMessagesTokens(result) <= tokenBudget) return result;
    }

    if (!changed) break;
  }

  return result;
}

export function computeMessageTokenBudget(
  config: ContextBudgetConfig,
  overheadTexts: string[],
  toolsTokenEstimate?: number,
  extraOverheadTokens = 0
): number {
  const toolsTokens = Math.max(
    toolsTokenEstimate ?? 0,
    config.toolSchemaReserve
  );
  const overheadTokens =
    overheadTexts.reduce((sum, text) => sum + estimateTokens(text), 0) +
    toolsTokens +
    config.outputReserve +
    config.safetyMargin +
    extraOverheadTokens;
  return Math.max(512, config.contextWindow - overheadTokens);
}

export function isContextLengthError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /context length|input_tokens|maximum context|too many tokens/i.test(
    message
  );
}
