import { Injectable } from "@nestjs/common";
import { ConversationRunnerService } from "./conversation-runner.service.js";
import { ModelFactoryService } from "./model-factory.service.js";
import { ToolingGatewayService } from "./tooling-gateway.service.js";
import { MemoryManagerService } from "../memory/memory-manager.service.js";
import { TodoStoreService } from "./todo-store.service.js";
import { createTodoTool } from "./todo-tool.factory.js";
import type { AgentChatOptions, AgentEvent } from "./agent.types.js";

@Injectable()
export class AgentService {
  constructor(
    private readonly modelFactory: ModelFactoryService,
    private readonly toolingGateway: ToolingGatewayService,
    private readonly conversationRunner: ConversationRunnerService,
    private readonly memoryManager: MemoryManagerService,
    private readonly todoStore: TodoStoreService
  ) {}

  async getMcpToolsList(): Promise<{ name: string; description?: string }[]> {
    return this.toolingGateway.listTools();
  }

  async chat(options: AgentChatOptions, onEvent?: (event: AgentEvent) => void) {
    const llm = this.modelFactory.create(this.modelFactory.getDefaultModel());
    const memoryTool = this.memoryManager.createMemoryToolForUser(
      options.userScope.userId
    );
    const todoTool = createTodoTool(options.sessionId, this.todoStore);
    const extraTools = [todoTool, memoryTool];

    const { tools, close } = await this.toolingGateway.getLangChainTools(
      extraTools
    );
    try {
      return this.conversationRunner.run(
        llm,
        tools,
        {
          ...options,
          refreshMemoryBlocks: () =>
            this.memoryManager.refreshBuiltinBlocks(options.userScope.userId),
        },
        onEvent
      );
    } finally {
      await close();
    }
  }
}
