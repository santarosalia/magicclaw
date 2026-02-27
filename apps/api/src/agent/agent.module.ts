import { Module } from "@nestjs/common";
import { AgentController } from "./agent.controller.js";
import { McpModule } from "../mcp/mcp.module.js";
import { LlmModule } from "../llm/llm.module.js";
import { AgentGateway } from "./agent.gateway.js";
import { AgentService } from "./agent.service.js";
import { SessionService } from "./session.service.js";

@Module({
  imports: [McpModule, LlmModule],
  controllers: [AgentController],
  providers: [AgentService, SessionService, AgentGateway],
})
export class AgentModule {}
