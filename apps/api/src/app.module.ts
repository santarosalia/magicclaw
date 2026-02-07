import { Module } from "@nestjs/common";
import { McpModule } from "./mcp/mcp.module";
import { AgentModule } from "./agent/agent.module";

@Module({
  imports: [McpModule, AgentModule],
})
export class AppModule {}
