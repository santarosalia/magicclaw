import { Body, Controller, Post } from "@nestjs/common";
import type { FlowRunRequestDto, FlowRunResultDto } from "./dto/flow-run.dto.js";
import { EngineService } from "./engine.service.js";

@Controller("engine")
export class EngineController {
  constructor(private readonly engine: EngineService) {}

  /**
   * ReactFlow 노드/엣지 JSON을 받아 MCP 툴을 순서대로 실행합니다.
   * POST body: { nodes: FlowNodeDto[], edges?: FlowEdgeDto[] }
   */
  @Post("run")
  async runFlow(@Body() body: FlowRunRequestDto): Promise<FlowRunResultDto> {
    return this.engine.runFlow(body);
  }
}
