import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  CreateMcpServerDto,
  McpServerConfig,
  UpdateMcpServerDto,
} from './dto/mcp-server.dto.js';

@Injectable()
export class McpStoreService {
  private servers = new Map<string, McpServerConfig>();

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
    return updated;
  }

  remove(id: string): boolean {
    return this.servers.delete(id);
  }
}
