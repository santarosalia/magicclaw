import { BadRequestException, Injectable, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type {
  CreateMcpServerDto,
  McpServerConfig,
  McpServerConfigRemote,
  McpServerConfigStdio,
  UpdateMcpServerDto,
} from "../mcp/dto/mcp-server.dto.js";
import { FileStoreService } from "../common/file-store.service.js";

interface McpStoreData {
  servers: Record<string, McpServerConfig>;
}

function normalizeServer(raw: McpServerConfig): McpServerConfig {
  if (raw.type === "http" || raw.type === "sse") {
    return raw;
  }
  const stdio = raw as McpServerConfigStdio;
  return {
    id: stdio.id,
    name: stdio.name,
    type: "stdio",
    command: stdio.command,
    args: stdio.args ?? [],
    env: stdio.env,
    createdAt: stdio.createdAt,
  };
}

function assertValidUrl(url: string): void {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new BadRequestException("MCP URL은 http 또는 https여야 합니다.");
    }
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException("유효한 MCP URL을 입력해주세요.");
  }
}

@Injectable()
export class McpStoreService extends FileStoreService implements OnModuleInit {
  private servers = new Map<string, McpServerConfig>();
  private readonly STORE_FILE = "mcp-servers.json";

  onModuleInit() {
    this.loadFromFile();
  }

  private loadFromFile(): void {
    const data = this.readFile<McpStoreData>(this.STORE_FILE, { servers: {} });
    this.servers = new Map(
      Object.entries(data.servers).map(([id, server]) => [
        id,
        normalizeServer(server),
      ])
    );
  }

  private saveToFile(): void {
    const data: McpStoreData = {
      servers: Object.fromEntries(this.servers),
    };
    this.writeFile(this.STORE_FILE, data);
  }

  findAll(): McpServerConfig[] {
    return Array.from(this.servers.values()).sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
  }

  findOne(id: string): McpServerConfig | undefined {
    return this.servers.get(id);
  }

  create(dto: CreateMcpServerDto): McpServerConfig {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const type = dto.type ?? "stdio";

    let config: McpServerConfig;
    if (type === "http" || type === "sse") {
      const url = dto.url?.trim();
      if (!url) {
        throw new BadRequestException("MCP URL이 필요합니다.");
      }
      assertValidUrl(url);
      config = {
        id,
        name: dto.name,
        type,
        url,
        headers: dto.headers,
        createdAt,
      } satisfies McpServerConfigRemote;
    } else {
      const command = dto.command?.trim();
      if (!command) {
        throw new BadRequestException("stdio MCP는 command가 필요합니다.");
      }
      config = {
        id,
        name: dto.name,
        type: "stdio",
        command,
        args: dto.args ?? [],
        env: dto.env,
        createdAt,
      } satisfies McpServerConfigStdio;
    }

    this.servers.set(id, config);
    this.saveToFile();
    return config;
  }

  update(id: string, dto: UpdateMcpServerDto): McpServerConfig | undefined {
    const existing = this.servers.get(id);
    if (!existing) return undefined;

    if (dto.type && dto.type !== existing.type) {
      throw new BadRequestException("MCP 서버 타입은 변경할 수 없습니다.");
    }

    if (existing.type === "stdio") {
      const updated: McpServerConfigStdio = {
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

    const url = dto.url !== undefined ? dto.url.trim() : existing.url;
    if (dto.url !== undefined) assertValidUrl(url);

    const updated: McpServerConfigRemote = {
      ...existing,
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.url !== undefined && { url }),
      ...(dto.headers !== undefined && { headers: dto.headers }),
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
