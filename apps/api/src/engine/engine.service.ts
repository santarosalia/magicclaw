import { Injectable } from "@nestjs/common";
import {
  callMcpTool,
  listToolsFromMcpServer,
} from "../mcp/mcp-client.service.js";
import type { McpServerConfig } from "../mcp/dto/mcp-server.dto.js";
import { McpStoreService } from "../mcp/mcp-store.service.js";
import type {
  FlowRunRequestDto,
  FlowRunResultDto,
  FlowNodeResult,
  FlowNodeDto,
} from "./dto/flow-run.dto.js";

/** 툴 이름 → MCP 서버 설정 캐시 */
const toolServerCache = new Map<string, McpServerConfig>();

/**
 * 엣지 기준 위상 정렬. source → target 순서로 실행되도록 노드 id 배열 반환.
 */
function topologicalOrder(
  nodeIds: string[],
  edges: { source: string; target: string }[]
): string[] {
  const inDegree = new Map<string, number>();
  const outEdges = new Map<string, string[]>();

  for (const id of nodeIds) {
    inDegree.set(id, 0);
    outEdges.set(id, []);
  }
  for (const e of edges) {
    if (!nodeIds.includes(e.source) || !nodeIds.includes(e.target)) continue;
    outEdges.get(e.source)!.push(e.target);
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
  }

  const queue = nodeIds.filter((id) => inDegree.get(id) === 0);
  const order: string[] = [];
  while (queue.length > 0) {
    const u = queue.shift()!;
    order.push(u);
    for (const v of outEdges.get(u) ?? []) {
      const d = inDegree.get(v)! - 1;
      inDegree.set(v, d);
      if (d === 0) queue.push(v);
    }
  }
  return order.length === nodeIds.length ? order : nodeIds;
}

@Injectable()
export class EngineService {
  constructor(private readonly mcpStore: McpStoreService) {}

  private async findServerForTool(toolName: string): Promise<McpServerConfig | null> {
    const cached = toolServerCache.get(toolName);
    if (cached) return cached;

    for (const server of this.mcpStore.findAll()) {
      const result = await listToolsFromMcpServer(server);
      if (result.tools.some((t) => t.name === toolName)) {
        toolServerCache.set(toolName, server);
        return server;
      }
    }
    return null;
  }

  private async executeToolCall(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<{ text: string; isError: boolean }> {
    const server = await this.findServerForTool(toolName);
    if (!server) {
      return {
        text: `Error: No MCP server provides tool "${toolName}"`,
        isError: true,
      };
    }
    const result = await callMcpTool(server, toolName, args);
    const text = result.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("\n");
    return { text, isError: Boolean(result.isError) };
  }

  /**
   * ReactFlow 노드/엣지 JSON을 받아 toolCall 노드만 추출한 뒤,
   * 엣지 순서(위상정렬) 또는 노드 순서대로 MCP 툴을 실행합니다.
   */
  async runFlow(request: FlowRunRequestDto): Promise<FlowRunResultDto> {
    const { nodes, edges = [] } = request;

    const toolNodes = nodes.filter(
      (n): n is FlowNodeDto & { data: { name: string } } =>
        (n.type === "toolCall" || n.type === undefined) &&
        typeof n.data?.name === "string"
    );
    if (toolNodes.length === 0) {
      return { results: [], executedCount: 0 };
    }

    const nodeMap = new Map(toolNodes.map((n) => [n.id, n]));
    const nodeIds = toolNodes.map((n) => n.id);
    const order =
      edges.length > 0
        ? topologicalOrder(nodeIds, edges)
        : nodeIds;

    const results: FlowNodeResult[] = [];
    for (const id of order) {
      const node = nodeMap.get(id);
      if (!node) continue;

      const toolName = node.data.name;
      const args = node.data.args ?? {};
      const { text, isError } = await this.executeToolCall(toolName, args);
      results.push({
        nodeId: node.id,
        toolName,
        success: !isError,
        output: text,
        isError,
      });
    }

    return {
      results,
      executedCount: results.length,
    };
  }
}
