import { Global, Module } from "@nestjs/common";
import { McpController } from "./mcp.controller.js";
import { StoreModule } from "../store/store.module.js";
import { MessengerModule } from "../messenger/messenger.module.js";
import { McpAdapterConnectionPool } from "./mcp-adapter.pool.js";
import { McpAdapterService } from "./mcp-adapter.service.js";

@Global()
@Module({
  controllers: [McpController],
  imports: [StoreModule, MessengerModule],
  providers: [McpAdapterConnectionPool, McpAdapterService],
  exports: [McpAdapterService],
})
export class McpModule {}
