import { Module } from '@nestjs/common';
import { LlmController } from './llm.controller.js';
import { LlmStoreService } from './llm-store.service.js';

@Module({
  controllers: [LlmController],
  providers: [LlmStoreService],
  exports: [LlmStoreService],
})
export class LlmModule {}
