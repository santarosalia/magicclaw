import { Injectable } from "@nestjs/common";
import { ConversationRunnerService } from "./conversation-runner.service.js";
import { ModelFactoryService } from "./model-factory.service.js";
import { ToolingGatewayService } from "./tooling-gateway.service.js";
import { MemoryManagerService } from "../memory/memory-manager.service.js";
import { TodoStoreService } from "./todo-store.service.js";
import { createTodoTool } from "./todo-tool.factory.js";
import { SessionSearchService } from "../session/session-search.service.js";
import { createSessionSearchTool } from "../session/session-search-tool.factory.js";
import { SkillStoreService } from "../skills/skill-store.service.js";
import { createSkillManageTool } from "../skills/skill-manage-tool.factory.js";
import { SkillsHubService } from "../skills/skills-hub.service.js";
import type { AgentChatOptions, AgentEvent } from "./agent.types.js";

@Injectable()
export class AgentService {
  constructor(
    private readonly modelFactory: ModelFactoryService,
    private readonly toolingGateway: ToolingGatewayService,
    private readonly conversationRunner: ConversationRunnerService,
    private readonly memoryManager: MemoryManagerService,
    private readonly todoStore: TodoStoreService,
    private readonly sessionSearch: SessionSearchService,
    private readonly skillStore: SkillStoreService,
    private readonly skillsHub: SkillsHubService
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
    const sessionSearchTool = createSessionSearchTool(
      options.userScope.userId,
      options.sessionId,
      this.sessionSearch
    );
    const skillManageTool = createSkillManageTool(
      this.skillStore,
      this.skillsHub
    );
    const extraTools = [todoTool, memoryTool, sessionSearchTool, skillManageTool];

    const { tools, close } = await this.toolingGateway.getLangChainTools(
      extraTools
    );
    try {
      return await this.conversationRunner.run(
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
