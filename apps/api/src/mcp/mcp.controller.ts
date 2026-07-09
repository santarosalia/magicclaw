import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import type {
  CreateMcpServerDto,
  McpServerConfig,
  SetMcpServerEnabledDto,
  UpdateMcpServerDto,
} from "./dto/mcp-server.dto.js";
import { isMcpServerEnabled } from "./dto/mcp-server.dto.js";
import { McpStoreService } from "../store/mcp-store.service.js";
import { McpAdapterService } from "./mcp-adapter.service.js";

@Controller("mcp")
export class McpController {
  constructor(
    private readonly store: McpStoreService,
    private readonly mcpAdapter: McpAdapterService
  ) {}

  @Get("servers")
  listServers(): McpServerConfig[] {
    return this.store.findAll();
  }

  /** 등록된 모든 MCP 서버의 연결 상태 조회 (툴 목록 조회로 연결 검사) */
  @Get("servers/status")
  async listServersStatus(): Promise<
    {
      id: string;
      name: string;
      enabled: boolean;
      status: "ok" | "error" | "disabled";
      error?: string;
    }[]
  > {
    const servers = this.store.findAll();
    const results = await Promise.all(
      servers.map(async (config) => {
        if (!isMcpServerEnabled(config)) {
          return {
            id: config.id,
            name: config.name,
            enabled: false,
            status: "disabled" as const,
          };
        }
        const result = await this.mcpAdapter.listToolsFromMcpServer(config);
        if (result.error) {
          return {
            id: config.id,
            name: config.name,
            enabled: true,
            status: "error" as const,
            error: result.error,
          };
        }
        return {
          id: config.id,
          name: config.name,
          enabled: true,
          status: "ok" as const,
        };
      })
    );
    return results;
  }

  @Get("servers/:id")
  getServer(@Param("id") id: string): McpServerConfig | undefined {
    return this.store.findOne(id);
  }

  @Post("servers")
  createServer(@Body() dto: CreateMcpServerDto): McpServerConfig {
    return this.store.create(dto);
  }

  @Patch("servers/:id")
  updateServer(
    @Param("id") id: string,
    @Body() dto: UpdateMcpServerDto
  ): McpServerConfig | undefined {
    return this.store.update(id, dto);
  }

  @Patch("servers/:id/enabled")
  setServerEnabled(
    @Param("id") id: string,
    @Body() dto: SetMcpServerEnabledDto
  ): McpServerConfig | undefined {
    return this.store.setEnabled(id, dto.enabled);
  }

  @Delete("servers/:id")
  removeServer(@Param("id") id: string): { deleted: boolean } {
    return { deleted: this.store.remove(id) };
  }

  @Get("servers/:id/tools")
  async listServerTools(
    @Param("id") id: string
  ): Promise<{
    tools: { name: string; description?: string }[];
    error?: string;
  }> {
    const config = this.store.findOne(id);
    if (!config) {
      return { tools: [], error: "Server not found" };
    }
    const result = await this.mcpAdapter.listToolsFromMcpServer(config);
    return {
      tools: result.tools.map((t) => ({
        name: t.name,
        description: t.description,
      })),
      error: result.error,
    };
  }
}
