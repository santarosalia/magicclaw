export class CreateMcpServerDto {
  name!: string;
  /** stdio: command (e.g. "npx") and args (e.g. ["-y", "some-mcp-server"]) */
  type!: 'stdio';
  command!: string;
  args!: string[];
  env?: Record<string, string>;
}

export class UpdateMcpServerDto {
  name?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpServerConfig {
  id: string;
  name: string;
  type: 'stdio';
  command: string;
  args: string[];
  env?: Record<string, string>;
  createdAt: string;
}

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}
