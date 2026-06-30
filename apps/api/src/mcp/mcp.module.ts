import { Module } from "@nestjs/common";
import { McpController } from "./mcp.controller.js";
import { StoreModule } from "../store/store.module.js";
import { McpAdapterConnectionPool } from "./mcp-adapter.pool.js";
import { McpAdapterService } from "./mcp-adapter.service.js";

@Module({
  controllers: [McpController],
  imports: [StoreModule],
  providers: [McpAdapterConnectionPool, McpAdapterService],
  exports: [McpAdapterService],
})
export class McpModule {}
