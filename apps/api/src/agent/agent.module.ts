import { Module } from "@nestjs/common";
import { AgentController } from "./agent.controller.js";
import { AgentGateway } from "./agent.gateway.js";
import { AgentService } from "./agent.service.js";
import { StoreModule } from "../store/store.module.js";
import { McpModule } from "../mcp/mcp.module.js";
import { SessionModule } from "../session/session.module.js";
import { ModelFactoryService } from "./model-factory.service.js";
import { ToolingGatewayService } from "./tooling-gateway.service.js";
import { ConversationRunnerService } from "./conversation-runner.service.js";
import { AgentChatOrchestratorService } from "./agent-chat-orchestrator.service.js";
import { CHAT_ORCHESTRATOR } from "../messenger/chat-orchestrator.port.js";

@Module({
  imports: [StoreModule, McpModule, SessionModule],
  controllers: [AgentController],
  providers: [
    AgentService,
    ModelFactoryService,
    ToolingGatewayService,
    ConversationRunnerService,
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
