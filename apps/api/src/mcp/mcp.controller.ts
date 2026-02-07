import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import type {
  CreateMcpServerDto,
  McpServerConfig,
  UpdateMcpServerDto,
} from './dto/mcp-server.dto.js';
import { listToolsFromMcpServer } from './mcp-client.service.js';
import { McpStoreService } from './mcp-store.service.js';

@Controller('mcp')
export class McpController {
  constructor(private readonly store: McpStoreService) {}

  @Get('servers')
  listServers(): McpServerConfig[] {
    return this.store.findAll();
  }

  @Get('servers/:id')
  getServer(@Param('id') id: string): McpServerConfig | undefined {
    return this.store.findOne(id);
  }

  @Post('servers')
  createServer(@Body() dto: CreateMcpServerDto): McpServerConfig {
    return this.store.create(dto);
  }

  @Patch('servers/:id')
  updateServer(
    @Param('id') id: string,
    @Body() dto: UpdateMcpServerDto,
  ): McpServerConfig | undefined {
    return this.store.update(id, dto);
  }

  @Delete('servers/:id')
  removeServer(@Param('id') id: string): { deleted: boolean } {
    return { deleted: this.store.remove(id) };
  }

  @Get('servers/:id/tools')
  async listServerTools(@Param('id') id: string): Promise<{ tools: { name: string; description?: string }[]; error?: string }> {
    const config = this.store.findOne(id);
    if (!config) {
      return { tools: [], error: 'Server not found' };
    }
    const result = await listToolsFromMcpServer(config);
    return {
      tools: result.tools.map((t) => ({ name: t.name, description: t.description })),
      error: result.error,
    };
  }
}
