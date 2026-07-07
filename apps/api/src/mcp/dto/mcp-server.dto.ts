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
  /** 기본값 true. false이면 에이전트가 이 서버에 연결하지 않습니다. */
  enabled?: boolean;
}

export class UpdateMcpServerDto {
  name?: string;
  type?: McpServerType;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
}

export class SetMcpServerEnabledDto {
  enabled!: boolean;
}

interface McpServerConfigBase {
  id: string;
  name: string;
  createdAt: string;
  /** 기본값 true. false이면 에이전트가 이 서버에 연결하지 않습니다. */
  enabled?: boolean;
}

export interface McpServerConfigStdio extends McpServerConfigBase {
  type: "stdio";
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface McpServerConfigRemote extends McpServerConfigBase {
  type: "http" | "sse";
  url: string;
  headers?: Record<string, string>;
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

export function isMcpServerEnabled(config: McpServerConfig): boolean {
  return config.enabled !== false;
}
