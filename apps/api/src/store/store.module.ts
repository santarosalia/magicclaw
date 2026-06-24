import { Module } from "@nestjs/common";
import { McpStoreService } from "./mcp-store.service.js";
import { MessengerStoreService } from "./messenger-store.service.js";
import { LlmStoreService } from "./llm-store.service.js";
import { MemoryConfigStoreService } from "./memory-config-store.service.js";

@Module({
  providers: [
    McpStoreService,
    MessengerStoreService,
    LlmStoreService,
    MemoryConfigStoreService,
  ],
  exports: [
    McpStoreService,
    MessengerStoreService,
    LlmStoreService,
    MemoryConfigStoreService,
  ],
})
export class StoreModule {}

