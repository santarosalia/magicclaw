export type McpServerType = "stdio" | "http" | "sse";

export class CreateMcpServerDto {
  name!: string;
  type!: McpServerType;
  /** stdio: command (e.g. "npx") and args */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** http/sse: remote MCP endpoint */
  url?: string;
  headers?: Record<string, string>;
}

export class UpdateMcpServerDto {
  name?: string;
  type?: McpServerType;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

export interface McpServerConfigStdio {
  id: string;
  name: string;
  type: "stdio";
  command: string;
  args: string[];
  env?: Record<string, string>;
  createdAt: string;
}

export interface McpServerConfigRemote {
  id: string;
  name: string;
  type: "http" | "sse";
  url: string;
  headers?: Record<string, string>;
  createdAt: string;
}

export type McpServerConfig = McpServerConfigStdio | McpServerConfigRemote;

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export function formatMcpServerEndpoint(config: McpServerConfig): string {
  if (config.type === "stdio") {
    return `${config.command} ${config.args.join(" ")}`.trim();
  }
  return config.url;
}

export function isRemoteMcpServer(
  config: McpServerConfig
): config is McpServerConfigRemote {
  return config.type === "http" || config.type === "sse";
}
