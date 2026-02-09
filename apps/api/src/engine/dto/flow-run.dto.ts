/**
 * ReactFlow 호환 플로우 실행 요청.
 * nodes / edges JSON을 그대로 받아 toolCall 노드만 순서대로 실행합니다.
 */
export interface FlowNodeData {
  name: string;
  argsSummary?: string;
  /** 실행 시 사용할 인자. 없으면 {} */
  args?: Record<string, unknown>;
}

export interface FlowNodeDto {
  id: string;
  type?: string;
  position?: { x: number; y: number };
  data: FlowNodeData;
}

export interface FlowEdgeDto {
  id: string;
  source: string;
  target: string;
}

export interface FlowRunRequestDto {
  nodes: FlowNodeDto[];
  edges?: FlowEdgeDto[];
}

export interface FlowNodeResult {
  nodeId: string;
  toolName: string;
  success: boolean;
  /** 텍스트 결과 또는 에러 메시지 */
  output: string;
  isError?: boolean;
}

export interface FlowRunResultDto {
  results: FlowNodeResult[];
  /** 실행된 툴 호출 수 */
  executedCount: number;
}
