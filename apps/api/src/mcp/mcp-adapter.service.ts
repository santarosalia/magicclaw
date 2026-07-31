import { Injectable } from "@nestjs/common";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { McpServerConfig, McpToolInfo } from "./dto/mcp-server.dto.js";
import { McpAdapterConnectionPool } from "./mcp-adapter.pool.js";
import { formatMcpConnectionError } from "./mcp-connection-error.util.js";

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
  return tools.map((tool) => ({
    name: tool.name,
    description:
      typeof tool.description === "string" ? tool.description : undefined,
    inputSchema:
      typeof (tool as { schema?: unknown }).schema === "object"
        ? ((tool as { schema: Record<string, unknown> }).schema as Record<
            string,
            unknown
          >)
        : undefined,
  }));
}

@Injectable()
export class McpAdapterService {
  constructor(private readonly pool: McpAdapterConnectionPool) {}

  async getMcpToolsAsLangChain(
    servers: McpServerConfig[]
  ): Promise<{
    tools: StructuredToolInterface[];
    close: () => Promise<void>;
  }> {
    const result = await this.pool.connect(servers, {
      allowCache: true,
      strict: false,
    });
    return {
      tools: result.tools,
      close: result.close,
    };
  }

  async listToolsFromMcpServer(
    config: McpServerConfig
  ): Promise<ListToolsResult> {
    try {
      const result = await this.pool.connect([config], {
        strict: true,
        allowCache: false,
      });
      await result.close();

      const tools = langChainToolsToMcpToolInfo(result.tools);
      if (tools.length === 0) {
        return {
          tools: [],
          error:
            result.errors[0] ??
            "MCP 서버에서 도구를 불러오지 못했습니다. URL, 전송 방식, Authorization 헤더를 확인하세요.",
        };
      }

      return { tools };
    } catch (err) {
      return {
        tools: [],
        error: formatMcpConnectionError(err),
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
