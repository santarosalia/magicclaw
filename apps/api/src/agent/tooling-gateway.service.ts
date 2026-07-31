import { Injectable } from "@nestjs/common";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { McpAdapterService } from "../mcp/mcp-adapter.service.js";
import { McpStoreService } from "../store/mcp-store.service.js";
import {
  createCoreTools,
  listCoreToolDescriptors,
} from "./core-tools/create-core-tools.js";

@Injectable()
export class ToolingGatewayService {
  constructor(
    private readonly mcpStore: McpStoreService,
    private readonly mcpAdapter: McpAdapterService
  ) {}

  async listTools(): Promise<{ name: string; description?: string }[]> {
    const core = listCoreToolDescriptors();
    const servers = this.mcpStore.findEnabled();
    const seen = new Set(core.map((t) => t.name));
    const tools = [...core];
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

  async getLangChainTools(
    extraTools: StructuredToolInterface[] = []
  ): Promise<{
    tools: StructuredToolInterface[];
    close: () => Promise<void>;
  }> {
    const coreTools = createCoreTools();
    const servers = this.mcpStore.findEnabled();
    const { tools, close } = await this.mcpAdapter.getMcpToolsAsLangChain(
      servers
    );
    // Prefer core tools when MCP registers the same name (e.g. read_file).
    const coreNames = new Set(coreTools.map((t) => t.name));
    const mcpWithoutOverlap = tools.filter((t) => !coreNames.has(t.name));
    return {
      tools: [...extraTools, ...coreTools, ...mcpWithoutOverlap],
      close,
    };
  }
}
