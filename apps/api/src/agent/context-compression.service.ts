import { Injectable } from "@nestjs/common";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "langchain";
import type { ChatOpenAI } from "@langchain/openai";
import { MemoryConfigStoreService } from "../store/memory-config-store.service.js";
import { MemoryManagerService } from "../memory/memory-manager.service.js";
import { TodoStoreService } from "./todo-store.service.js";
import { getMessageContentAsString } from "../agent/agent.types.js";
import {
  BASE_SYSTEM_PROMPT_TOKEN_RESERVE,
  computeMessageTokenBudget,
  getContextBudgetConfig,
  repairToolCallPairs,
  shrinkMessagesToBudget,
} from "./context-budget.util.js";

@Injectable()
export class ContextCompressionService {
  constructor(
    private readonly configStore: MemoryConfigStoreService,
    private readonly memoryManager: MemoryManagerService,
    private readonly todoStore: TodoStoreService
  ) {}

  async maybeCompress(
    sessionId: string,
    messages: BaseMessage[],
    llm?: ChatOpenAI,
    systemOverhead = "",
    contextWindow?: number
  ): Promise<BaseMessage[]> {
    const maxMessages = this.configStore.getConfig().maxContextMessages;
    if (messages.length <= maxMessages) {
      return this.trimToTokenBudget(messages, systemOverhead, contextWindow);
    }

    await this.memoryManager.onPreCompress(sessionId);

    const keepCount = Math.max(4, Math.floor(maxMessages / 2));
    const { head, middle, tail } = splitPairSafe(messages, keepCount);

    if (middle.length === 0 || !llm) {
      return this.trimToTokenBudget(
        [...head, ...tail],
        systemOverhead,
        contextWindow
      );
    }

    const summaryPrompt = [
      "Summarize the following conversation segment concisely.",
      "Preserve facts, decisions, and user preferences.",
      middle
        .map((m) => `${m.getType()}: ${getMessageContentAsString(m)}`)
        .join("\n"),
    ].join("\n\n");

    const todoBlock = this.todoStore.formatForInjection(sessionId);

    try {
      const response = await llm.invoke([
        new SystemMessage({ content: "You compress conversation history." }),
        new HumanMessage({ content: summaryPrompt }),
      ]);
      const summary = getMessageContentAsString(response).trim();
      if (!summary) {
        return this.trimToTokenBudget(
          [...head, ...tail],
          systemOverhead,
          contextWindow
        );
      }
      const compressed = new HumanMessage({
        content: `[Compressed context from earlier turns]\n${summary}`,
      });
      const withTodos = todoBlock
        ? [
            ...head,
            compressed,
            new HumanMessage({ content: todoBlock }),
            ...tail,
          ]
        : [...head, compressed, ...tail];
      return this.trimToTokenBudget(withTodos, systemOverhead, contextWindow);
    } catch {
      return this.trimToTokenBudget(
        [...head, ...tail],
        systemOverhead,
        contextWindow
      );
    }
  }

  private trimToTokenBudget(
    messages: BaseMessage[],
    systemOverhead: string,
    contextWindow?: number
  ): BaseMessage[] {
    const config = getContextBudgetConfig({ contextWindow });
    const budget = computeMessageTokenBudget(
      config,
      [systemOverhead],
      undefined,
      BASE_SYSTEM_PROMPT_TOKEN_RESERVE
    );
    return shrinkMessagesToBudget(messages, budget);
  }
}

/** Split history without cutting AI tool_calls away from their ToolMessages. */
export function splitPairSafe(
  messages: BaseMessage[],
  keepCount: number
): { head: BaseMessage[]; middle: BaseMessage[]; tail: BaseMessage[] } {
  let headEnd = Math.min(2, messages.length);
  headEnd = expandForwardThroughTools(messages, headEnd);

  let tailStart = Math.max(headEnd, messages.length - keepCount);
  tailStart = expandBackwardThroughTools(messages, tailStart);

  if (tailStart < headEnd) {
    return { head: messages, middle: [], tail: [] };
  }

  const head = repairToolCallPairs(messages.slice(0, headEnd));
  const middle = messages.slice(headEnd, tailStart);
  const tail = repairToolCallPairs(messages.slice(tailStart));
  return { head, middle, tail };
}

function expandForwardThroughTools(
  messages: BaseMessage[],
  exclusiveEnd: number
): number {
  let end = exclusiveEnd;
  while (end > 0 && end < messages.length) {
    const prev = messages[end - 1];
    if (!(prev instanceof AIMessage) || !prev.tool_calls?.length) break;
    const ids = new Set(
      prev.tool_calls
        .map((t) => t.id)
        .filter((id): id is string => Boolean(id))
    );
    while (end < messages.length) {
      const next = messages[end];
      if (next instanceof ToolMessage && ids.has(next.tool_call_id)) {
        end++;
        continue;
      }
      break;
    }
    break;
  }
  return end;
}

function expandBackwardThroughTools(
  messages: BaseMessage[],
  start: number
): number {
  let s = start;
  while (s > 0 && s < messages.length && messages[s] instanceof ToolMessage) {
    s--;
  }
  return s;
}
