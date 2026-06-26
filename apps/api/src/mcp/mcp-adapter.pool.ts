import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import type { McpServerConfig } from "./dto/mcp-server.dto.js";
import { isRemoteMcpServer } from "./dto/mcp-server.dto.js";
import { shTool } from "./tool/sh.js";

type McpConnectionConfig =
  | {
      transport: "stdio";
      command: string;
      args: string[];
      env?: Record<string, string>;
    }
  | {
      transport: "http" | "sse";
      url: string;
      headers?: Record<string, string>;
    };

function getPoolKey(servers: McpServerConfig[]): string {
  const normalized = [...servers]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((server) => {
      if (isRemoteMcpServer(server)) {
        return {
          id: server.id,
          type: server.type,
          url: server.url,
          headers: server.headers ?? {},
        };
      }
      return {
        id: server.id,
        type: server.type,
        command: server.command,
        args: server.args ?? [],
        env: server.env ?? {},
      };
    });
  return JSON.stringify(normalized);
}

function buildMcpServersRecord(
  servers: McpServerConfig[]
): Record<string, McpConnectionConfig> {
  const mcpServers: Record<string, McpConnectionConfig> = {};
  for (const server of servers) {
    if (isRemoteMcpServer(server)) {
      mcpServers[server.id] = {
        transport: server.type,
        url: server.url,
        ...(server.headers &&
          Object.keys(server.headers).length > 0 && {
            headers: server.headers,
          }),
      };
      continue;
    }

    mcpServers[server.id] = {
      transport: "stdio",
      command: server.command,
      args: server.args ?? [],
      ...(server.env &&
        Object.keys(server.env).length > 0 && { env: server.env }),
    };
  }
  return mcpServers;
}

type PoolEntry = {
  client: MultiServerMCPClient;
  tools: StructuredToolInterface[];
  lastUsed: number;
};

@Injectable()
export class McpAdapterConnectionPool implements OnModuleDestroy {
  private readonly logger = new Logger(McpAdapterConnectionPool.name);
  private readonly pool = new Map<string, PoolEntry>();
  private readonly MAX_IDLE_MS = 5 * 60 * 1000; // 5분
  private readonly cleanupMs = 60_000; // 1분

  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    if (typeof setInterval !== "undefined") {
      this.cleanupTimer = setInterval(
        () => this.cleanupIdleConnections(),
        this.cleanupMs
      );
    }
  }

  async get(
    servers: McpServerConfig[]
  ): Promise<{ tools: StructuredToolInterface[]; release: () => void }> {
    const key = getPoolKey(servers);
    const existing = this.pool.get(key);

    if (existing) {
      existing.lastUsed = Date.now();
      return {
        tools: existing.tools,
        release: () => {
          existing.lastUsed = Date.now();
        },
      };
    }

    const client = new MultiServerMCPClient({
      mcpServers: buildMcpServersRecord(servers),
      useStandardContentBlocks: true,
      onConnectionError: "ignore",
    });

    const tools = await client.getTools();
    tools.push(shTool);

    const entry: PoolEntry = {
      client,
      tools,
      lastUsed: Date.now(),
    };
    this.pool.set(key, entry);

    return {
      tools: entry.tools,
      release: () => {
        entry.lastUsed = Date.now();
      },
    };
  }

  private cleanupIdleConnections(): void {
    const now = Date.now();
    for (const [key, entry] of this.pool.entries()) {
      if (now - entry.lastUsed <= this.MAX_IDLE_MS) continue;

      try {
        entry.client.close();
      } catch (err) {
        this.logger.warn(
          `Failed to close idle MCP client for key=${key}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
      this.pool.delete(key);
    }
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    for (const entry of this.pool.values()) {
      try {
        entry.client.close();
      } catch {
        // 무시
      }
    }
    this.pool.clear();
  }
}
