import { Module } from "@nestjs/common";
import { McpModule } from "./mcp/mcp.module";
import { AgentModule } from "./agent/agent.module";
import { LlmModule } from "./llm/llm.module";
import { EngineModule } from "./engine/engine.module";

@Module({
  imports: [McpModule, AgentModule, LlmModule, EngineModule],
})
export class AppModule {}
