import { Module } from '@nestjs/common';
import { McpController } from './mcp.controller.js';
import { McpStoreService } from './mcp-store.service.js';

@Module({
  controllers: [McpController],
  providers: [McpStoreService],
  exports: [McpStoreService],
})
export class McpModule {}
