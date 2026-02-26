"use client";

import { useCallback, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  type NodeTypes,
  Position,
  Handle,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Play, Loader2, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToolCall, ToolMessage } from "langchain";
import { useToolCallStore } from "@/stores/tool-call-store";

const NODE_HEIGHT = 80;
const GAP = 24;

type ToolCallNodeData = {
  name: string;
  argsSummary: string;
  args: Record<string, unknown>;
  onRun?: (nodeIndex: number) => void;
  isRunning?: boolean;
  toolMessage: ToolMessage;
};

function ToolCallNode({
  data,
  id,
}: NodeProps<Node<ToolCallNodeData, "toolCall">>) {
  // 노드 ID에서 인덱스 추출 (tc-0 -> 0)
  const nodeIndex = parseInt(id.replace("tc-", ""), 10);

  return (
    <div className="rounded-lg border-2 border-violet-500/60 bg-violet-950/40 px-3 py-2 shadow-lg min-w-[180px] relative">
      <Handle
        type="target"
        position={Position.Top}
        className="w-2! h-2! bg-violet-400!"
      />
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div
            className="font-mono text-sm font-semibold text-violet-200 truncate"
            title={data.name}
          >
            {data.name}
          </div>
          {data.argsSummary && (
            <pre
              className="mt-1 text-xs text-violet-300/90 overflow-hidden text-ellipsis whitespace-pre max-h-10"
              title={data.argsSummary}
            >
              {data.argsSummary}
            </pre>
          )}
          {data.toolMessage && (
            <div className="text-xs text-violet-300/90">
              {data.toolMessage.content as string}
            </div>
          )}
        </div>
        {data.onRun && (
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 shrink-0 text-violet-300 hover:text-violet-100 hover:bg-violet-500/30"
            onClick={() => data.onRun?.(nodeIndex)}
            disabled={data.isRunning}
            title="툴 실행"
          >
            {data.isRunning ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Play className="h-3 w-3" />
            )}
          </Button>
        )}
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="w-2! h-2! bg-violet-400!"
      />
    </div>
  );
}

const nodeTypes: NodeTypes = { toolCall: ToolCallNode };

function buildFlow(
  toolCalls: ToolCall[],
  toolMessages: ToolMessage[],
  onRun?: (nodeIndex: number) => void,
  runningNodeIndex?: number
): {
  nodes: Node[];
  edges: Edge[];
} {
  if (toolCalls.length === 0) return { nodes: [], edges: [] };

  const nodes: Node[] = toolCalls.map((tc, i) => {
    const nodeId = `tc-${i}`;
    const argsStr = Object.keys(tc.args).length
      ? JSON.stringify(tc.args).slice(0, 80) +
        (JSON.stringify(tc.args).length > 80 ? "…" : "")
      : "";
    return {
      id: nodeId,
      type: "toolCall",
      position: { x: 0, y: i * (NODE_HEIGHT + GAP) },
      data: {
        name: tc.name,
        argsSummary: argsStr,
        args: tc.args,
        toolMessage: toolMessages.find((tm) => tm.tool_call_id === tc.id),
        onRun,
        isRunning: runningNodeIndex === i,
      },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
    };
  });

  const edges: Edge[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    edges.push({
      id: `e-${i}-${i + 1}`,
      source: nodes[i].id,
      target: nodes[i + 1].id,
      type: "smoothstep",
      animated: true,
    });
  }

  return { nodes, edges };
}

interface ToolCallFlowProps {
  className?: string;
}

export function ToolCallFlow({ className }: ToolCallFlowProps) {
  const [runningNodeIndex, setRunningNodeIndex] = useState<
    number | undefined
  >();

  const { toolMessages, toolCalls } = useToolCallStore();
  const [isRunningAll, setIsRunningAll] = useState(false);

  const executeFlow = useCallback(
    async (toolCallsToRun: ToolCall[], startIndex: number = 0) => {
      // 노드와 엣지 생성
      const nodes = toolCallsToRun.map((tc, i) => {
        const globalIndex = startIndex + i;
        return {
          id: `tc-${globalIndex}`,
          type: "toolCall" as const,
          position: { x: 0, y: i * (NODE_HEIGHT + GAP) },
          data: {
            name: tc.name,
            args: tc.args || {},
            argsSummary: Object.keys(tc.args).length
              ? JSON.stringify(tc.args).slice(0, 80) +
                (JSON.stringify(tc.args).length > 80 ? "…" : "")
              : "",
            toolMessage: toolMessages.find((tm) => tm.tool_call_id === tc.id),
          },
        };
      });

      const edges = [];
      for (let i = 0; i < nodes.length - 1; i++) {
        edges.push({
          id: `e-${startIndex + i}-${startIndex + i + 1}`,
          source: nodes[i].id,
          target: nodes[i + 1].id,
        });
      }

      // API 요청 형식으로 변환
      const requestBody = {
        nodes,
        edges,
      };

      const res = await fetch("/api/engine/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (!res.ok) {
        throw new Error(await res.text());
      }

      const result = await res.json();
      console.log("툴 실행 결과:", result);
      return result;
    },
    []
  );

  const handleRun = useCallback(
    async (nodeIndex: number) => {
      setRunningNodeIndex(nodeIndex);
      try {
        // 해당 노드부터 끝까지의 toolCalls 추출
        const toolCallsToRun = toolCalls.slice(nodeIndex);
        await executeFlow(toolCallsToRun, nodeIndex);
      } catch (err) {
        console.error("툴 실행 오류:", err);
        alert(
          "툴 실행 중 오류가 발생했습니다: " +
            (err instanceof Error ? err.message : String(err))
        );
      } finally {
        setRunningNodeIndex(undefined);
      }
    },
    [toolCalls, executeFlow]
  );

  const handleRunAll = useCallback(async () => {
    if (toolCalls.length === 0) return;
    setIsRunningAll(true);
    try {
      await executeFlow(toolCalls, 0);
    } catch (err) {
      console.error("전체 플로우 실행 오류:", err);
      alert(
        "전체 플로우 실행 중 오류가 발생했습니다: " +
          (err instanceof Error ? err.message : String(err))
      );
    } finally {
      setIsRunningAll(false);
    }
  }, [toolCalls, executeFlow]);

  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => buildFlow(toolCalls, toolMessages, handleRun, runningNodeIndex),
    [toolCalls, toolMessages, handleRun, runningNodeIndex]
  );

  const onInit = useCallback((_: unknown) => {
    // optional: fit view after mount
  }, []);

  if (toolCalls.length === 0) {
    return (
      <div
        className={`rounded-lg border border-dashed border-violet-500/30 bg-violet-950/20 flex items-center justify-center text-violet-400/70 text-sm ${
          className ?? ""
        }`}
      >
        툴 호출이 없습니다.
      </div>
    );
  }

  return (
    <div className={`${className} flex flex-col`}>
      <div className="flex items-center justify-between mb-2 px-1">
        <p className="text-xs text-muted-foreground">Tool calls</p>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1.5 border-violet-500/50 text-violet-300 hover:bg-violet-500/20 hover:text-violet-100"
          onClick={handleRunAll}
          disabled={isRunningAll || runningNodeIndex !== undefined}
        >
          {isRunningAll ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              실행 중...
            </>
          ) : (
            <>
              <PlayCircle className="h-3 w-3" />
              전체 실행
            </>
          )}
        </Button>
      </div>
      <div className="flex-1 min-h-0">
        <ReactFlow
          nodes={initialNodes}
          edges={initialEdges}
          onInit={onInit}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.2}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="rgba(139, 92, 246, 0.15)" gap={12} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}
