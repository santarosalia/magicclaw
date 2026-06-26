import { Injectable } from "@nestjs/common";
import { HumanMessage, type BaseMessage } from "langchain";
import { SessionService } from "../session/session.service.js";
import { SessionDbService } from "../session/session-db.service.js";
import { MemoryManagerService } from "../memory/memory-manager.service.js";
import { ContextCompressionService } from "./context-compression.service.js";
import { TodoStoreService } from "./todo-store.service.js";
import { AgentChannel } from "./agent.types.js";
import type { UserScope } from "../user/user-scope.js";
import { ModelFactoryService } from "./model-factory.service.js";

export interface TurnContext {
  sessionId: string;
  channel: AgentChannel;
  userScope: UserScope;
  userText: string;
  messagesLc: BaseMessage[];
  memoryContext: string;
  systemMemoryBlock: string;
  priorMessageCount: number;
}

@Injectable()
export class TurnContextService {
  constructor(
    private readonly session: SessionService,
    private readonly sessionDb: SessionDbService,
    private readonly memoryManager: MemoryManagerService,
    private readonly contextCompression: ContextCompressionService,
    private readonly todoStore: TodoStoreService,
    private readonly modelFactory: ModelFactoryService
  ) {}

  async build(input: {
    sessionId: string;
    channel: AgentChannel;
    userScope: UserScope;
    userText: string;
  }): Promise<TurnContext> {
    const { sessionId, channel, userScope, userText } = input;

    this.sessionDb.ensureSession(sessionId, {
      userId: userScope.userId,
      channel,
      title: "대화",
    });

    await this.memoryManager.initializeAll(userScope.userId, sessionId);

    const systemMemoryBlock = this.memoryManager.buildSystemPromptBlock(
      userScope.userId
    );
    const llm = this.modelFactory.create();
    const history = await this.session.ensureLoaded(sessionId);
    const compressedHistory = await this.contextCompression.maybeCompress(
      sessionId,
      history,
      llm,
      systemMemoryBlock
    );

    const userMsg = new HumanMessage({ content: userText.trim() });
    const builtinContext = this.memoryManager.buildBuiltinTurnContext(
      userScope.userId
    );
    const memoryPrefetch = await this.memoryManager.prefetchAll(
      userText.trim(),
      sessionId
    );
    const todoBlock = this.todoStore.formatForInjection(sessionId);
    const memoryContext = [builtinContext, memoryPrefetch, todoBlock]
      .filter(Boolean)
      .join("\n\n");

    return {
      sessionId,
      channel,
      userScope,
      userText: userText.trim(),
      messagesLc: [...compressedHistory, userMsg],
      memoryContext,
      systemMemoryBlock,
      priorMessageCount: compressedHistory.length,
    };
  }
}
