import { Injectable } from "@nestjs/common";
import type { BaseMessage } from "langchain";
import type { ChatOpenAI } from "@langchain/openai";
import { SystemMessage, HumanMessage } from "langchain";
import { MemoryConfigStoreService } from "../store/memory-config-store.service.js";
import { MemoryManagerService } from "../memory/memory-manager.service.js";
import { TodoStoreService } from "./todo-store.service.js";
import { getMessageContentAsString } from "../agent/agent.types.js";

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
    llm?: ChatOpenAI
  ): Promise<BaseMessage[]> {
    const maxMessages = this.configStore.getConfig().maxContextMessages;
    if (messages.length <= maxMessages) return messages;

    await this.memoryManager.onPreCompress(sessionId);

    const keepCount = Math.max(4, Math.floor(maxMessages / 2));
    const head = messages.slice(0, 2);
    const tail = messages.slice(-keepCount);
    const middle = messages.slice(2, messages.length - keepCount);

    if (middle.length === 0 || !llm) {
      return [...head, ...tail];
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
      if (!summary) return [...head, ...tail];
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
      return withTodos;
    } catch {
      return [...head, ...tail];
    }
  }
}
