import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import type { CreateLlmConfigDto, LlmConfig, UpdateLlmConfigDto } from './dto/llm-config.dto.js';
import { LlmStoreService } from './llm-store.service.js';

@Controller('llm')
export class LlmController {
  constructor(private readonly llmStore: LlmStoreService) {}

  @Get('configs')
  async listConfigs(): Promise<LlmConfig[]> {
    return this.llmStore.findAll();
  }

  @Get('configs/default')
  async getDefaultConfig(): Promise<LlmConfig | null> {
    return this.llmStore.findDefault() ?? null;
  }

  @Get('configs/:id')
  async getConfig(@Param('id') id: string): Promise<LlmConfig | null> {
    return this.llmStore.findOne(id) ?? null;
  }

  @Post('configs')
  async createConfig(@Body() dto: CreateLlmConfigDto): Promise<LlmConfig> {
    return this.llmStore.create(dto);
  }

  @Put('configs/:id')
  async updateConfig(
    @Param('id') id: string,
    @Body() dto: UpdateLlmConfigDto,
  ): Promise<LlmConfig | null> {
    return this.llmStore.update(id, dto) ?? null;
  }

  @Post('configs/:id/default')
  async setDefault(@Param('id') id: string): Promise<{ success: boolean }> {
    const success = this.llmStore.setDefault(id);
    return { success };
  }

  @Delete('configs/:id')
  async removeConfig(@Param('id') id: string): Promise<{ success: boolean }> {
    const success = this.llmStore.remove(id);
    return { success };
  }
}
