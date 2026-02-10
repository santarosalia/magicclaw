"use client";

import { useCallback, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeTypes,
  Position,
  Handle,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

export interface ToolCallEntry {
  name: string;
  args: Record<string, unknown>;
}

const NODE_HEIGHT = 80;
const GAP = 24;

type ToolCallNodeData = { name: string; argsSummary: string };

function ToolCallNode({ data }: NodeProps<Node<ToolCallNodeData, "toolCall">>) {
  return (
    <div className="rounded-lg border-2 border-violet-500/60 bg-violet-950/40 px-3 py-2 shadow-lg min-w-[180px]">
      <Handle
        type="target"
        position={Position.Top}
        className="w-2! h-2! bg-violet-400!"
      />
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
      <Handle
        type="source"
        position={Position.Bottom}
        className="w-2! h-2! bg-violet-400!"
      />
    </div>
  );
}

const nodeTypes: NodeTypes = { toolCall: ToolCallNode };

function buildFlow(toolCalls: ToolCallEntry[]): {
  nodes: Node[];
  edges: Edge[];
} {
  if (toolCalls.length === 0) return { nodes: [], edges: [] };

  const nodes: Node[] = toolCalls.map((tc, i) => {
    const argsStr = Object.keys(tc.args).length
      ? JSON.stringify(tc.args).slice(0, 80) +
        (JSON.stringify(tc.args).length > 80 ? "…" : "")
      : "";
    return {
      id: `tc-${i}`,
      type: "toolCall",
      position: { x: 0, y: i * (NODE_HEIGHT + GAP) },
      data: { name: tc.name, argsSummary: argsStr },
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
  toolCalls: ToolCallEntry[];
  className?: string;
}

export function ToolCallFlow({ toolCalls, className }: ToolCallFlowProps) {
  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => buildFlow(toolCalls),
    [toolCalls]
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
    <div className={className}>
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
        {/* <MiniMap
          nodeColor={(n) => "rgba(139, 92, 246, 0.6)"}
          maskColor="rgba(0,0,0,0.7)"
        /> */}
      </ReactFlow>
    </div>
  );
}
