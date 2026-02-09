import { Injectable, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  CreateMcpServerDto,
  McpServerConfig,
  UpdateMcpServerDto,
} from './dto/mcp-server.dto.js';
import { FileStoreService } from '../common/file-store.service.js';

interface McpStoreData {
  servers: Record<string, McpServerConfig>;
}

@Injectable()
export class McpStoreService extends FileStoreService implements OnModuleInit {
  private servers = new Map<string, McpServerConfig>();
  private readonly STORE_FILE = 'mcp-servers.json';

  onModuleInit() {
    this.loadFromFile();
  }

  private loadFromFile(): void {
    const data = this.readFile<McpStoreData>(
      this.STORE_FILE,
      { servers: {} }
    );
    this.servers = new Map(Object.entries(data.servers));
  }

  private saveToFile(): void {
    const data: McpStoreData = {
      servers: Object.fromEntries(this.servers),
    };
    this.writeFile(this.STORE_FILE, data);
  }

  findAll(): McpServerConfig[] {
    return Array.from(this.servers.values()).sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }

  findOne(id: string): McpServerConfig | undefined {
    return this.servers.get(id);
  }

  create(dto: CreateMcpServerDto): McpServerConfig {
    const id = randomUUID();
    const config: McpServerConfig = {
      id,
      name: dto.name,
      type: 'stdio',
      command: dto.command,
      args: dto.args ?? [],
      env: dto.env,
      createdAt: new Date().toISOString(),
    };
    this.servers.set(id, config);
    this.saveToFile();
    return config;
  }

  update(id: string, dto: UpdateMcpServerDto): McpServerConfig | undefined {
    const existing = this.servers.get(id);
    if (!existing) return undefined;
    const updated: McpServerConfig = {
      ...existing,
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.command !== undefined && { command: dto.command }),
      ...(dto.args !== undefined && { args: dto.args }),
      ...(dto.env !== undefined && { env: dto.env }),
    };
    this.servers.set(id, updated);
    this.saveToFile();
    return updated;
  }

  remove(id: string): boolean {
    const deleted = this.servers.delete(id);
    if (deleted) {
      this.saveToFile();
    }
    return deleted;
  }
}
