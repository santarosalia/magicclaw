import { Module } from '@nestjs/common';
import { LlmController } from './llm.controller.js';
import { StoreModule } from '../store/store.module.js';

@Module({
  controllers: [LlmController],
  imports: [StoreModule],
})
export class LlmModule {}
