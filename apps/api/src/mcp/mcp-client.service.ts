import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
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

function toEnvRecord(
  env: Record<string, string | undefined> | undefined
): Record<string, string> | undefined {
  if (!env) return undefined;
  return Object.fromEntries(
    Object.entries(env).filter(([, v]) => v !== undefined)
  ) as Record<string, string>;
}

/**
 * MCP 연결 풀 - 브라우저 인스턴스가 재시작되지 않도록 연결을 재사용
 */
class McpConnectionPool {
  private connections = new Map<
    string,
    { client: Client; transport: StdioClientTransport; lastUsed: number }
  >();
  private readonly MAX_IDLE_TIME = 5 * 60 * 1000; // 5분

  private getConnectionKey(config: McpServerConfig): string {
    return `${config.command}:${JSON.stringify(
      config.args || []
    )}:${JSON.stringify(config.env || {})}`;
  }

  async getConnection(
    config: McpServerConfig
  ): Promise<{ client: Client; transport: StdioClientTransport }> {
    const key = this.getConnectionKey(config);
    let conn = this.connections.get(key);

    // 기존 연결이 있고 유효하면 재사용
    if (conn) {
      conn.lastUsed = Date.now();
      return { client: conn.client, transport: conn.transport };
    }

    // 새 연결 생성
    const env = config.env
      ? toEnvRecord({ ...process.env, ...config.env })
      : undefined;
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env,
    });
    const client = new Client({ name: "magicclaw", version: "0.1.0" });
    await client.connect(transport);

    this.connections.set(key, { client, transport, lastUsed: Date.now() });
    return { client, transport };
  }

  async releaseConnection(config: McpServerConfig): Promise<void> {
    // 연결을 풀에 유지 (종료하지 않음)
    const key = this.getConnectionKey(config);
    const conn = this.connections.get(key);
    if (conn) {
      conn.lastUsed = Date.now();
    }
  }

  async closeConnection(config: McpServerConfig): Promise<void> {
    const key = this.getConnectionKey(config);
    const conn = this.connections.get(key);
    if (conn) {
      try {
        conn.client.close();
      } catch (err) {
        // 연결 종료 중 오류 무시
      }
      this.connections.delete(key);
    }
  }

  // 유휴 연결 정리
  cleanupIdleConnections(): void {
    const now = Date.now();
    for (const [key, conn] of this.connections.entries()) {
      if (now - conn.lastUsed > this.MAX_IDLE_TIME) {
        try {
          conn.client.close();
        } catch (err) {
          // 연결 종료 중 오류 무시
        }
        this.connections.delete(key);
      }
    }
  }
}

const connectionPool = new McpConnectionPool();

// 주기적으로 유휴 연결 정리 (1분마다)
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    connectionPool.cleanupIdleConnections();
  }, 60000);
}

/**
 * List tools from an MCP server (stdio). Uses connection pooling to reuse browser instances.
 */
export async function listToolsFromMcpServer(
  config: McpServerConfig
): Promise<ListToolsResult> {
  const { client } = await connectionPool.getConnection(config);
  try {
    const result = await client.listTools();
    const tools: McpToolInfo[] = (result.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description ?? undefined,
      inputSchema: t.inputSchema as Record<string, unknown> | undefined,
    }));
    return { tools };
  } catch (err) {
    return {
      tools: [],
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    // 연결을 종료하지 않고 풀에 반환
    await connectionPool.releaseConnection(config);
  }
}

/**
 * Call a tool via MCP client. Uses connection pooling to reuse browser instances.
 */
export async function callMcpTool(
  config: McpServerConfig,
  toolName: string,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  const { client } = await connectionPool.getConnection(config);
  try {
    const result = await client.callTool({ name: toolName, arguments: args });
    const rawContent = (result.content ?? []) as Array<{
      type: string;
      text?: string;
      data?: string;
      mimeType?: string;
    }>;
    const content = rawContent.map((c) => {
      if (c.type === "text")
        return { type: "text" as const, text: c.text ?? "" };
      if (c.type === "image")
        return {
          type: "image" as const,
          data: c.data ?? "",
          mimeType: c.mimeType,
        };
      return { type: "text" as const, text: JSON.stringify(c) };
    });
    return {
      content,
      isError: Boolean(result.isError),
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: err instanceof Error ? err.message : String(err),
        },
      ],
      isError: true,
    };
  } finally {
    // 연결을 종료하지 않고 풀에 반환
    await connectionPool.releaseConnection(config);
  }
}
