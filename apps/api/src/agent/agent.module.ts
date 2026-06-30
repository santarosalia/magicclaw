import { Module } from "@nestjs/common";
import { AgentController } from "./agent.controller.js";
import { AgentGateway } from "./agent.gateway.js";
import { AgentService } from "./agent.service.js";
import { StoreModule } from "../store/store.module.js";
import { McpModule } from "../mcp/mcp.module.js";
import { SessionModule } from "../session/session.module.js";
import { MemoryModule } from "../memory/memory.module.js";
import { UserModule } from "../user/user.module.js";
import { SkillsModule } from "../skills/skills.module.js";
import { ContextFilesService } from "../common/context-files.service.js";
import { ModelFactoryService } from "./model-factory.service.js";
import { ToolingGatewayService } from "./tooling-gateway.service.js";
import { ConversationRunnerService } from "./conversation-runner.service.js";
import { AgentChatOrchestratorService } from "./agent-chat-orchestrator.service.js";
import { ContextCompressionService } from "./context-compression.service.js";
import { TurnContextService } from "./turn-context.service.js";
import { TurnFinalizerService } from "./turn-finalizer.service.js";
import { TurnPipelineService } from "./turn-pipeline.service.js";
import { TodoStoreService } from "./todo-store.service.js";
import { CHAT_ORCHESTRATOR } from "../messenger/chat-orchestrator.port.js";

@Module({
  imports: [StoreModule, McpModule, SessionModule, MemoryModule, UserModule, SkillsModule],
  controllers: [AgentController],
  providers: [
    AgentService,
    ContextFilesService,
    ModelFactoryService,
    ToolingGatewayService,
    ConversationRunnerService,
    ContextCompressionService,
    TurnContextService,
    TurnFinalizerService,
    TurnPipelineService,
    TodoStoreService,
    AgentGateway,
    AgentChatOrchestratorService,
    {
      provide: CHAT_ORCHESTRATOR,
      useExisting: AgentChatOrchestratorService,
    },
  ],
  exports: [AgentService, CHAT_ORCHESTRATOR],
})
export class AgentModule {}
