import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import type { CreateLlmConfigDto, LlmConfig, UpdateLlmConfigDto } from './dto/llm-config.dto.js';
import { LlmStoreService } from './llm-store.service.js';

/** GET /v1/models 응답 (OpenAI 호환) */
interface ModelsListResponse {
  data?: Array<{ id: string }>;
  object?: string;
}

export interface LlmStatusResponse {
  configured: boolean;
  connected: boolean;
  modelAvailable?: boolean;
  error?: string;
}

@Controller('llm')
export class LlmController {
  constructor(private readonly llmStore: LlmStoreService) {}

  @Get('configs')
  async listConfigs(): Promise<LlmConfig[]> {
    return this.llmStore.findAll();
  }

  /**
   * 기본 LLM 설정 기준으로 실제 연결 및 설정 모델 존재 여부 확인.
   * baseURL/v1/models 를 호출해 연결 가능 여부와 모델 목록에 해당 모델이 있는지 검사.
   */
  @Get('status')
  async getLlmStatus(): Promise<LlmStatusResponse> {
    const config = this.llmStore.findDefault();
    if (!config) {
      return { configured: false, connected: false };
    }

    const base = config.baseURL.replace(/\/$/, '');
    const modelsPath = base.includes('/v1') ? '/models' : '/v1/models';
    const url = `${base}${modelsPath}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
    }

    try {
      const res = await fetch(url, { headers });
      if (!res.ok) {
        const text = await res.text();
        return {
          configured: true,
          connected: false,
          modelAvailable: false,
          error: `HTTP ${res.status}: ${text.slice(0, 200)}`,
        };
      }

      const json = (await res.json()) as ModelsListResponse;
      const list = json?.data ?? [];
      const modelIds = list.map((m) => m.id);
      const modelAvailable = modelIds.includes(config.model);

      return {
        configured: true,
        connected: true,
        modelAvailable,
        ...(modelAvailable ? {} : { error: `모델 "${config.model}"이(가) 서버 목록에 없습니다.` }),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        configured: true,
        connected: false,
        modelAvailable: false,
        error: message,
      };
    }
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
