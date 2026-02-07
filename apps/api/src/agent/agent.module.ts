import { Module } from '@nestjs/common';
import { AgentController } from './agent.controller.js';
import { AgentService } from './agent.service.js';
import { McpModule } from '../mcp/mcp.module.js';

@Module({
  imports: [McpModule],
  controllers: [AgentController],
  providers: [AgentService],
})
export class AgentModule {}
