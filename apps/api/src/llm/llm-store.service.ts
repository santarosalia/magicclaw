import { Injectable, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { CreateLlmConfigDto, LlmConfig, UpdateLlmConfigDto } from './dto/llm-config.dto.js';
import { FileStoreService } from '../common/file-store.service.js';

interface LlmStoreData {
  configs: Record<string, LlmConfig>;
  defaultId: string | null;
}

@Injectable()
export class LlmStoreService extends FileStoreService implements OnModuleInit {
  private configs = new Map<string, LlmConfig>();
  private defaultId: string | null = null;
  private readonly STORE_FILE = 'llm-configs.json';

  onModuleInit() {
    this.loadFromFile();
  }

  private loadFromFile(): void {
    const data = this.readFile<LlmStoreData>(
      this.STORE_FILE,
      { configs: {}, defaultId: null }
    );
    this.configs = new Map(Object.entries(data.configs));
    this.defaultId = data.defaultId;
  }

  private saveToFile(): void {
    const data: LlmStoreData = {
      configs: Object.fromEntries(this.configs),
      defaultId: this.defaultId,
    };
    this.writeFile(this.STORE_FILE, data);
  }

  findAll(): LlmConfig[] {
    return Array.from(this.configs.values()).sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }

  findOne(id: string): LlmConfig | undefined {
    return this.configs.get(id);
  }

  findDefault(): LlmConfig | undefined {
    if (this.defaultId) {
      return this.configs.get(this.defaultId);
    }
    return undefined;
  }

  create(dto: CreateLlmConfigDto): LlmConfig {
    const id = randomUUID();
    const config: LlmConfig = {
      id,
      name: dto.name,
      baseURL: dto.baseURL,
      model: dto.model,
      apiKey: dto.apiKey,
      createdAt: new Date().toISOString(),
      isDefault: false,
    };
    this.configs.set(id, config);
    
    // 첫 번째 설정을 기본값으로 설정
    if (this.configs.size === 1) {
      this.setDefault(id);
    } else {
      this.saveToFile();
    }
    
    return config;
  }

  update(id: string, dto: UpdateLlmConfigDto): LlmConfig | undefined {
    const existing = this.configs.get(id);
    if (!existing) return undefined;
    const updated: LlmConfig = {
      ...existing,
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.baseURL !== undefined && { baseURL: dto.baseURL }),
      ...(dto.model !== undefined && { model: dto.model }),
      ...(dto.apiKey !== undefined && { apiKey: dto.apiKey }),
    };
    this.configs.set(id, updated);
    this.saveToFile();
    return updated;
  }

  setDefault(id: string): boolean {
    if (!this.configs.has(id)) return false;
    
    // 기존 기본값 제거
    if (this.defaultId) {
      const oldDefault = this.configs.get(this.defaultId);
      if (oldDefault) {
        oldDefault.isDefault = false;
      }
    }
    
    // 새 기본값 설정
    this.defaultId = id;
    const newDefault = this.configs.get(id);
    if (newDefault) {
      newDefault.isDefault = true;
    }
    
    this.saveToFile();
    return true;
  }

  remove(id: string): boolean {
    if (this.defaultId === id) {
      this.defaultId = null;
    }
    const deleted = this.configs.delete(id);
    if (deleted) {
      this.saveToFile();
    }
    return deleted;
  }
}
