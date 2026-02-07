import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { McpServerConfig } from './dto/mcp-server.dto.js';
import type { McpToolInfo } from './dto/mcp-server.dto.js';

export interface ListToolsResult {
  tools: McpToolInfo[];
  error?: string;
}

export interface CallToolResult {
  content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType?: string }>;
  isError?: boolean;
}

function toEnvRecord(env: Record<string, string | undefined> | undefined): Record<string, string> | undefined {
  if (!env) return undefined;
  return Object.fromEntries(
    Object.entries(env).filter(([, v]) => v !== undefined),
  ) as Record<string, string>;
}

/**
 * List tools from an MCP server (stdio). Starts process, lists tools, then closes.
 */
export async function listToolsFromMcpServer(config: McpServerConfig): Promise<ListToolsResult> {
  const env = config.env
    ? toEnvRecord({ ...process.env, ...config.env })
    : undefined;
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    env,
  });
  const client = new Client({ name: 'magicclaw', version: '0.1.0' });
  try {
    await client.connect(transport);
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
    client.close();
  }
}

/**
 * Call a tool via MCP client. Uses a fresh connection per call for simplicity; can be optimized with connection pooling.
 */
export async function callMcpTool(
  config: McpServerConfig,
  toolName: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const env = config.env
    ? toEnvRecord({ ...process.env, ...config.env })
    : undefined;
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    env,
  });
  const client = new Client({ name: 'magicclaw', version: '0.1.0' });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name: toolName, arguments: args });
    const rawContent = (result.content ?? []) as Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
    const content = rawContent.map((c) => {
      if (c.type === 'text') return { type: 'text' as const, text: c.text ?? '' };
      if (c.type === 'image')
        return {
          type: 'image' as const,
          data: c.data ?? '',
          mimeType: c.mimeType,
        };
      return { type: 'text' as const, text: JSON.stringify(c) };
    });
    return {
      content,
      isError: Boolean(result.isError),
    };
  } catch (err) {
    return {
      content: [
        {
          type: 'text',
          text: err instanceof Error ? err.message : String(err),
        },
      ],
      isError: true,
    };
  } finally {
    client.close();
  }
}
