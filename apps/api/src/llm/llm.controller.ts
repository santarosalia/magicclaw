import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from "@nestjs/common";
import type {
  CreateLlmConfigDto,
  LlmConfig,
  UpdateLlmConfigDto,
} from "./dto/llm-config.dto.js";
import { LlmStoreService } from "../store/llm-store.service.js";
import {
  findModelEntry,
  resolveModelContextWindow,
  type ContextWindowSource,
} from "./context-window.util.js";

/** GET /v1/models 응답 (OpenAI 호환) */
interface ModelsListResponse {
  data?: Array<Record<string, unknown> & { id?: string }>;
  object?: string;
}

export interface LlmStatusResponse {
  configured: boolean;
  connected: boolean;
  modelAvailable?: boolean;
  contextWindow?: number;
  contextWindowSource?: ContextWindowSource;
  error?: string;
}

@Controller("llm")
export class LlmController {
  constructor(private readonly llmStore: LlmStoreService) {}

  @Get("configs")
  async listConfigs(): Promise<LlmConfig[]> {
    return this.llmStore.findAll();
  }

  /**
   * 기본 LLM 설정 기준으로 실제 연결 및 설정 모델 존재 여부 확인.
   * baseURL/v1/models 를 호출해 연결·모델 존재·context window를 갱신한다.
   */
  @Get("status")
  async getLlmStatus(): Promise<LlmStatusResponse> {
    const config = this.llmStore.findDefault();
    if (!config) {
      return { configured: false, connected: false };
    }

    const probe = await this.probeModels(config);
    if (!probe.ok) {
      return {
        configured: true,
        connected: false,
        modelAvailable: false,
        contextWindow: config.contextWindow,
        contextWindowSource: config.contextWindowSource,
        error: probe.error,
      };
    }

    const modelAvailable = probe.modelIds.includes(config.model);
    const resolved = resolveModelContextWindow({
      modelId: config.model,
      entry: findModelEntry(probe.models, config.model),
    });
    const updated = this.llmStore.setContextWindow(
      config.id,
      resolved.contextWindow,
      resolved.source
    );

    return {
      configured: true,
      connected: true,
      modelAvailable,
      contextWindow: updated?.contextWindow ?? resolved.contextWindow,
      contextWindowSource:
        updated?.contextWindowSource ?? resolved.source,
      ...(modelAvailable
        ? {}
        : { error: `모델 "${config.model}"이(가) 서버 목록에 없습니다.` }),
    };
  }

  @Get("configs/default")
  async getDefaultConfig(): Promise<LlmConfig | null> {
    return this.llmStore.findDefault() ?? null;
  }

  @Get("configs/:id")
  async getConfig(@Param("id") id: string): Promise<LlmConfig | null> {
    return this.llmStore.findOne(id) ?? null;
  }

  @Post("configs")
  async createConfig(@Body() dto: CreateLlmConfigDto): Promise<LlmConfig> {
    const created = this.llmStore.create(dto);
    await this.refreshContextWindow(created.id);
    return this.llmStore.findOne(created.id) ?? created;
  }

  @Put("configs/:id")
  async updateConfig(
    @Param("id") id: string,
    @Body() dto: UpdateLlmConfigDto
  ): Promise<LlmConfig | null> {
    const updated = this.llmStore.update(id, dto);
    if (!updated) return null;
    // Manual contextWindow in dto already set source=manual; skip overwrite.
    if (dto.contextWindow === undefined) {
      await this.refreshContextWindow(id);
    }
    return this.llmStore.findOne(id) ?? updated;
  }

  @Post("configs/:id/default")
  async setDefault(@Param("id") id: string): Promise<{ success: boolean }> {
    const success = this.llmStore.setDefault(id);
    if (success) {
      await this.refreshContextWindow(id);
    }
    return { success };
  }

  @Post("configs/:id/refresh-context-window")
  async refreshConfigContextWindow(
    @Param("id") id: string
  ): Promise<LlmConfig | null> {
    if (!this.llmStore.findOne(id)) return null;
    await this.refreshContextWindow(id, { force: true });
    return this.llmStore.findOne(id) ?? null;
  }

  @Delete("configs/:id")
  async removeConfig(@Param("id") id: string): Promise<{ success: boolean }> {
    const success = this.llmStore.remove(id);
    return { success };
  }

  private async refreshContextWindow(
    id: string,
    opts?: { force?: boolean }
  ): Promise<void> {
    const config = this.llmStore.findOne(id);
    if (!config) return;
    if (!opts?.force && config.contextWindowSource === "manual") return;

    const probe = await this.probeModels(config);
    const entry = probe.ok
      ? findModelEntry(probe.models, config.model)
      : undefined;
    const resolved = resolveModelContextWindow({
      modelId: config.model,
      entry,
    });
    this.llmStore.setContextWindow(
      id,
      resolved.contextWindow,
      resolved.source,
      { force: opts?.force }
    );
  }

  private async probeModels(config: LlmConfig): Promise<
    | { ok: true; models: unknown[]; modelIds: string[] }
    | { ok: false; error: string }
  > {
    const base = config.baseURL.replace(/\/$/, "");
    const modelsPath = base.includes("/v1") ? "/models" : "/v1/models";
    const url = `${base}${modelsPath}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (config.apiKey) {
      headers["Authorization"] = `Bearer ${config.apiKey}`;
    }

    try {
      const res = await fetch(url, { headers });
      if (!res.ok) {
        const text = await res.text();
        return {
          ok: false,
          error: `HTTP ${res.status}: ${text.slice(0, 200)}`,
        };
      }

      const json = (await res.json()) as ModelsListResponse;
      const list = json?.data ?? [];
      const modelIds = list
        .map((m) => m.id)
        .filter((id): id is string => typeof id === "string");
      return { ok: true, models: list, modelIds };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  }
}
