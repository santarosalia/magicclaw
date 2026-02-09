import { Module } from "@nestjs/common";
import { EngineController } from "./engine.controller.js";
import { EngineService } from "./engine.service.js";
import { McpModule } from "../mcp/mcp.module.js";

@Module({
  imports: [McpModule],
  controllers: [EngineController],
  providers: [EngineService],
})
export class EngineModule {}
