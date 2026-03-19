import { Module } from "@nestjs/common";
import { AgentController } from "./agent.controller.js";
import { AgentGateway } from "./agent.gateway.js";
import { AgentService } from "./agent.service.js";
import { SessionService } from "./session.service.js";
import { StoreModule } from "../store/store.module.js";
import { McpModule } from "../mcp/mcp.module.js";

@Module({
  imports: [StoreModule, McpModule],
  controllers: [AgentController],
  providers: [AgentService, SessionService, AgentGateway],
  exports: [AgentService],
})
export class AgentModule {}
