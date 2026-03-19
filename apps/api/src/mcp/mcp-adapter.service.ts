import { Injectable } from "@nestjs/common";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { McpServerConfig, McpToolInfo } from "./dto/mcp-server.dto.js";
import { McpAdapterConnectionPool } from "./mcp-adapter.pool.js";

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

@Injectable()
export class McpAdapterService {
  constructor(
    private readonly pool: McpAdapterConnectionPool
  ) {}

  async getMcpToolsAsLangChain(
    servers: McpServerConfig[]
  ): Promise<{
    tools: StructuredToolInterface[];
    close: () => Promise<void>;
  }> {
    if (servers.length === 0) {
      return { tools: [], close: async () => {} };
    }

    const { tools, release } = await this.pool.get(servers);
    return {
      tools,
      close: async () => {
        release();
      },
    };
  }

  async listToolsFromMcpServer(
    config: McpServerConfig
  ): Promise<ListToolsResult> {
    try {
      const { tools, close } = await this.getMcpToolsAsLangChain([config]);
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

  async callMcpTool(
    config: McpServerConfig,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<CallToolResult> {
    const { tools, close } = await this.getMcpToolsAsLangChain([config]);
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
}

