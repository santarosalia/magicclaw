import { Module } from "@nestjs/common";
import { McpStoreService } from "./mcp-store.service.js";
import { MessengerStoreService } from "./messenger-store.service.js";
import { LlmStoreService } from "./llm-store.service.js";

@Module({
  providers: [McpStoreService, MessengerStoreService, LlmStoreService],
  exports: [McpStoreService, MessengerStoreService, LlmStoreService],
})
export class StoreModule {}

