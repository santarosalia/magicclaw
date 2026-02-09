import { Module } from "@nestjs/common";
import { McpModule } from "./mcp/mcp.module";
import { AgentModule } from "./agent/agent.module";
import { LlmModule } from "./llm/llm.module";

@Module({
  imports: [McpModule, AgentModule, LlmModule],
})
export class AppModule {}
