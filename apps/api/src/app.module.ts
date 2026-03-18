import { Module } from "@nestjs/common";
import { McpModule } from "./mcp/mcp.module";
import { AgentModule } from "./agent/agent.module";
import { LlmModule } from "./llm/llm.module";
import { EngineModule } from "./engine/engine.module";
import { MessengerModule } from "./messenger/messenger.module";

@Module({
  imports: [McpModule, AgentModule, LlmModule, EngineModule, MessengerModule],
})
export class AppModule {}
