import type { StructuredToolInterface } from "@langchain/core/tools";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import type { McpServerConfig } from "./dto/mcp-server.dto.js";
import type { McpToolInfo } from "./dto/mcp-server.dto.js";

export interface ListToolsResult {
  tools: McpToolInfo[];
  error?: string;
}

export interface CallToolResult {
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType?: string }
  >;
  isError?: boolean;
}

/** 서버 집합에 대한 풀 키 (동일 설정 = 동일 연결 재사용) */
function getPoolKey(servers: McpServerConfig[]): string {
  const normalized = [...servers]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((s) => ({
      id: s.id,
      command: s.command,
      args: s.args ?? [],
      env: s.env ?? {},
    }));
  return JSON.stringify(normalized);
}

/**
 * Adapter 클라이언트 연결 풀 - 동일 서버 집합이면 연결 재사용, 유휴 시 정리
 */
class McpAdapterConnectionPool {
  private pool = new Map<
    string,
    {
      client: MultiServerMCPClient;
      tools: StructuredToolInterface[];
      lastUsed: number;
    }
  >();
  private readonly MAX_IDLE_MS = 5 * 60 * 1000; // 5분

  async get(
    servers: McpServerConfig[]
  ): Promise<{ tools: StructuredToolInterface[]; release: () => void }> {
    const key = getPoolKey(servers);
    let entry = this.pool.get(key);

    if (entry) {
      entry.lastUsed = Date.now();
      return {
        tools: entry.tools,
        release: () => {
          entry!.lastUsed = Date.now();
        },
      };
    }

    const mcpServers = buildMcpServersRecord(servers);
    const client = new MultiServerMCPClient({
      mcpServers,
      useStandardContentBlocks: true,
      onConnectionError: "ignore",
    });
    const tools = await client.getTools();
    entry = { client, tools, lastUsed: Date.now() };
    this.pool.set(key, entry);

    return {
      tools: entry.tools,
      release: () => {
        entry!.lastUsed = Date.now();
      },
    };
  }

  close(key: string): void {
    const entry = this.pool.get(key);
    if (entry) {
      try {
        entry.client.close();
      } catch {
        // 무시
      }
      this.pool.delete(key);
    }
  }

  cleanupIdleConnections(): void {
    const now = Date.now();
    for (const [key, entry] of this.pool.entries()) {
      if (now - entry.lastUsed > this.MAX_IDLE_MS) {
        try {
          entry.client.close();
        } catch {
          // 무시
        }
        this.pool.delete(key);
      }
    }
  }
}

const adapterPool = new McpAdapterConnectionPool();

if (typeof setInterval !== "undefined") {
  setInterval(() => adapterPool.cleanupIdleConnections(), 60000);
}

function langChainToolsToMcpToolInfo(
  tools: StructuredToolInterface[]
): McpToolInfo[] {
  return tools.map((t) => ({
    name: t.name,
    description: typeof t.description === "string" ? t.description : undefined,
    inputSchema:
      typeof (t as { schema?: unknown }).schema === "object"
        ? ((t as { schema: Record<string, unknown> }).schema as Record<
            string,
            unknown
          >)
        : undefined,
  }));
}

function buildMcpServersRecord(servers: McpServerConfig[]): Record<
  string,
  {
    transport: "stdio";
    command: string;
    args: string[];
    env?: Record<string, string>;
  }
> {
  const mcpServers: Record<
    string,
    {
      transport: "stdio";
      command: string;
      args: string[];
      env?: Record<string, string>;
    }
  > = {};
  for (const s of servers) {
    mcpServers[s.id] = {
      transport: "stdio",
      command: s.command,
      args: s.args ?? [],
      ...(s.env && Object.keys(s.env).length > 0 && { env: s.env }),
    };
  }
  return mcpServers;
}

/**
 * List tools from an MCP server using @langchain/mcp-adapters.
 */
export async function listToolsFromMcpServer(
  config: McpServerConfig
): Promise<ListToolsResult> {
  try {
    const { tools, close } = await getMcpToolsAsLangChain([config]);
    await close();
    return {
      tools: langChainToolsToMcpToolInfo(tools),
    };
  } catch (err) {
    return {
      tools: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Call a tool via @langchain/mcp-adapters (single server).
 */
export async function callMcpTool(
  config: McpServerConfig,
  toolName: string,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  const { tools, close } = await getMcpToolsAsLangChain([config]);
  try {
    const tool = tools.find((t) => t.name === toolName);
    if (!tool) {
      return {
        content: [
          { type: "text" as const, text: `Tool "${toolName}" not found` },
        ],
        isError: true,
      };
    }
    const result = await tool.invoke(args);
    const text =
      typeof result === "string"
        ? result
        : typeof result === "object" && result !== null && "content" in result
        ? String((result as { content: unknown }).content)
        : JSON.stringify(result);
    return {
      content: [{ type: "text" as const, text }],
      isError: false,
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text" as const,
          text: err instanceof Error ? err.message : String(err),
        },
      ],
      isError: true,
    };
  } finally {
    await close();
  }
}

/** @langchain/mcp-adapters로 MCP 서버 연결 후 LangChain 도구 반환. close() 시 연결은 풀에 반환(재사용). */
export async function getMcpToolsAsLangChain(
  servers: McpServerConfig[]
): Promise<{
  tools: StructuredToolInterface[];
  close: () => Promise<void>;
}> {
  if (servers.length === 0) {
    return { tools: [], close: async () => {} };
  }
  const { tools, release } = await adapterPool.get(servers);
  return {
    tools,
    close: async () => {
      release();
    },
  };
}
