import { Injectable } from "@nestjs/common";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { McpAdapterService } from "../mcp/mcp-adapter.service.js";
import { McpStoreService } from "../store/mcp-store.service.js";

@Injectable()
export class ToolingGatewayService {
  constructor(
    private readonly mcpStore: McpStoreService,
    private readonly mcpAdapter: McpAdapterService
  ) {}

  async listTools(): Promise<{ name: string; description?: string }[]> {
    const servers = this.mcpStore.findAll();
    const seen = new Set<string>();
    const tools: { name: string; description?: string }[] = [];
    for (const server of servers) {
      const result = await this.mcpAdapter.listToolsFromMcpServer(server);
      for (const t of result.tools) {
        if (seen.has(t.name)) continue;
        seen.add(t.name);
        tools.push({ name: t.name, description: t.description });
      }
    }
    return tools;
  }

  async getLangChainTools(): Promise<{
    tools: StructuredToolInterface[];
    close: () => Promise<void>;
  }> {
    const servers = this.mcpStore.findAll();
    return this.mcpAdapter.getMcpToolsAsLangChain(servers);
  }
}
