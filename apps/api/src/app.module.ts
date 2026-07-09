import { Module } from "@nestjs/common";
import { McpModule } from "./mcp/mcp.module";
import { AgentModule } from "./agent/agent.module";
import { LlmModule } from "./llm/llm.module";
import { EngineModule } from "./engine/engine.module";
import { MessengerModule } from "./messenger/messenger.module";
import { MemoryModule } from "./memory/memory.module";
import { SessionModule } from "./session/session.module";
import { HealthModule } from "./health/health.module";

@Module({
  imports: [
    HealthModule,
    McpModule,
    AgentModule,
    LlmModule,
    EngineModule,
    MessengerModule,
    MemoryModule,
    SessionModule,
  ],
})
export class AppModule {}
