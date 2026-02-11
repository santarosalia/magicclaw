import { Module } from "@nestjs/common";
import { AgentController } from "./agent.controller.js";
import { AgentService } from "./agent.service.js";
import { McpModule } from "../mcp/mcp.module.js";
import { LlmModule } from "../llm/llm.module.js";
import { AgentGateway } from "./agent.gateway.js";

@Module({
  imports: [McpModule, LlmModule],
  controllers: [AgentController],
  providers: [AgentService, AgentGateway],
})
export class AgentModule {}
