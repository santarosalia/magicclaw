import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import type { McpServerConfig } from "./dto/mcp-server.dto.js";
import { isRemoteMcpServer } from "./dto/mcp-server.dto.js";
import { shTool } from "./tool/sh.js";
import { formatMcpConnectionError } from "./mcp-connection-error.util.js";

export const SH_TOOL_NAME = "sh";

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
      automaticSSEFallback?: boolean;
    };

export interface McpConnectOptions {
  /** 연결 실패 시 예외를 던집니다 (도구 목록 조회용). */
  strict?: boolean;
  /** 에이전트 실행용 내장 sh 도구를 포함합니다. */
  includeShTool?: boolean;
  /** 실패한 연결 결과를 캐시하지 않습니다. */
  allowCache?: boolean;
}

export interface McpConnectResult {
  tools: StructuredToolInterface[];
  mcpToolCount: number;
  errors: string[];
  release: () => void;
  close: () => Promise<void>;
}

function getPoolKey(servers: McpServerConfig[]): string {
  const normalized = [...servers]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((server) => {
      if (isRemoteMcpServer(server)) {
        return {
          name: server.name,
          type: server.type,
          url: server.url,
          headers: server.headers ?? {},
        };
      }
      return {
        name: server.name,
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
      mcpServers[server.name] = {
        transport: server.type,
        url: server.url,
        automaticSSEFallback: true,
        ...(server.headers &&
          Object.keys(server.headers).length > 0 && {
            headers: server.headers,
          }),
      };
      continue;
    }

    mcpServers[server.name] = {
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
  mcpToolCount: number;
  lastUsed: number;
};

@Injectable()
export class McpAdapterConnectionPool implements OnModuleDestroy {
  private readonly logger = new Logger(McpAdapterConnectionPool.name);
  private readonly pool = new Map<string, PoolEntry>();
  private readonly MAX_IDLE_MS = 5 * 60 * 1000;
  private readonly cleanupMs = 60_000;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    if (typeof setInterval !== "undefined") {
      this.cleanupTimer = setInterval(
        () => this.cleanupIdleConnections(),
        this.cleanupMs
      );
    }
  }

  async connect(
    servers: McpServerConfig[],
    options: McpConnectOptions = {}
  ): Promise<McpConnectResult> {
    const {
      strict = false,
      includeShTool = false,
      allowCache = !strict,
    } = options;

    if (servers.length === 0) {
      const tools = includeShTool ? [shTool] : [];
      return {
        tools,
        mcpToolCount: 0,
        errors: [],
        release: () => {},
        close: async () => {},
      };
    }

    const key = getPoolKey(servers);
    if (allowCache) {
      const existing = this.pool.get(key);
      if (existing) {
        existing.lastUsed = Date.now();
        const tools = this.composeTools(existing.tools, includeShTool);
        return {
          tools,
          mcpToolCount: existing.mcpToolCount,
          errors: [],
          release: () => {
            existing.lastUsed = Date.now();
          },
          close: async () => {},
        };
      }
    }

    const errors: string[] = [];
    const client = new MultiServerMCPClient({
      mcpServers: buildMcpServersRecord(servers),
      useStandardContentBlocks: true,
      onConnectionError: strict
        ? "throw"
        : (ctx) => {
            const message = formatMcpConnectionError(ctx.error);
            errors.push(`[${ctx.serverName}] ${message}`);
            this.logger.warn(
              `MCP server "${ctx.serverName}" connection failed: ${message}`
            );
          },
    });

    let mcpTools: StructuredToolInterface[] = [];
    try {
      mcpTools = await client.getTools();
    } catch (error) {
      await client.close().catch(() => {});
      throw new Error(formatMcpConnectionError(error), { cause: error });
    }

    const mcpToolCount = mcpTools.length;
    if (!strict && servers.length > 0 && mcpToolCount === 0) {
      errors.push(
        servers.length === 1
          ? "MCP 서버에서 도구를 불러오지 못했습니다. URL, 전송 방식(http/sse), 인증 헤더를 확인하세요."
          : "등록된 MCP 서버에서 도구를 불러오지 못했습니다."
      );
    }

    const shouldCache = allowCache && mcpToolCount > 0;
    if (shouldCache) {
      this.pool.set(key, {
        client,
        tools: mcpTools,
        mcpToolCount,
        lastUsed: Date.now(),
      });
    }

    const tools = this.composeTools(mcpTools, includeShTool);
    const release = () => {
      const entry = this.pool.get(key);
      if (entry) entry.lastUsed = Date.now();
    };
    const close = async () => {
      if (shouldCache) return;
      await client.close().catch(() => {});
    };

    return { tools, mcpToolCount, errors, release, close };
  }

  /** @deprecated use connect() */
  async get(
    servers: McpServerConfig[]
  ): Promise<{ tools: StructuredToolInterface[]; release: () => void }> {
    const result = await this.connect(servers, {
      includeShTool: true,
      allowCache: true,
    });
    return { tools: result.tools, release: result.release };
  }

  private composeTools(
    mcpTools: StructuredToolInterface[],
    includeShTool: boolean
  ): StructuredToolInterface[] {
    if (!includeShTool) return [...mcpTools];
    const names = new Set(mcpTools.map((tool) => tool.name));
    return names.has(SH_TOOL_NAME) ? [...mcpTools] : [...mcpTools, shTool];
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
        // ignore
      }
    }
    this.pool.clear();
  }
}
