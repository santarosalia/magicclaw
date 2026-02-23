import { Injectable } from "@nestjs/common";
import OpenAI from "openai";
import type { McpServerConfig } from "../mcp/dto/mcp-server.dto.js";
import {
  callMcpTool,
  listToolsFromMcpServer,
} from "../mcp/mcp-client.service.js";
import { McpStoreService } from "../mcp/mcp-store.service.js";
import { LlmStoreService } from "../llm/llm-store.service.js";
import { ChatOpenAI } from "@langchain/openai";
import {
  HumanMessage,
  AIMessage,
  SystemMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import {
  StateGraph,
  START,
  END,
  MessagesAnnotation,
} from "@langchain/langgraph";
import { ToolNode, toolsCondition } from "@langchain/langgraph/prebuilt";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface AgentChatOptions {
  messages: ChatMessage[];
  model?: string;
}

export type AgentEvent =
  | {
      type: "tool_call";
      name: string;
      args: Record<string, unknown>;
    }
  | {
      type: "tool_result";
      name: string;
      output: string;
    }
  | {
      type: "assistant_message";
      content: string;
    }
  | {
      type: "final_message";
      message: string;
      toolCallsUsed: number;
      toolCalls: ToolCallEntry[];
    };

export interface ToolCallEntry {
  name: string;
  args: Record<string, unknown>;
}

export interface AgentChatResult {
  message: string;
  toolCallsUsed: number;
  toolCalls: ToolCallEntry[];
}

/** Map MCP tool to OpenAI tool definition format */
function mcpToolToOpenAI(t: {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}): OpenAI.Chat.Completions.ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: t.name,
      description: t.description ?? "",
      parameters: t.inputSchema ?? { type: "object", properties: {} },
    },
  };
}

@Injectable()
export class AgentService {
  private toolServerCache = new Map<string, McpServerConfig>();
  constructor(
    private readonly mcpStore: McpStoreService,
    private readonly llmStore: LlmStoreService,
  ) {}

  /** Collect all tools from registered MCP servers and return OpenAI-format tools. */
  async getMcpToolsAsOpenAI(): Promise<
    OpenAI.Chat.Completions.ChatCompletionTool[]
  > {
    const servers = this.mcpStore.findAll();
    const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [];
    for (const server of servers) {
      const result = await listToolsFromMcpServer(server);
      for (const t of result.tools) {
        tools.push(mcpToolToOpenAI(t));
      }
    }
    return tools;
  }

  /** Resolve which MCP server has this tool (by re-listing; can be optimized with cache). */
  private async findServerForTool(toolName: string) {
    if (this.toolServerCache.has(toolName)) {
      return this.toolServerCache.get(toolName);
    }

    for (const server of this.mcpStore.findAll()) {
      const result = await listToolsFromMcpServer(server);
      if (result.tools.some((t) => t.name === toolName)) {
        this.toolServerCache.set(toolName, server);
        return server;
      }
    }
  }

  /** Execute one tool call via MCP and return content for the assistant message. */
  private async executeToolCall(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    const server = await this.findServerForTool(toolName);
    if (!server) return `Error: No MCP server provides tool "${toolName}"`;
    const result = await callMcpTool(server, toolName, args);
    const texts = result.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text);
    return texts.join("\n");
  }

  /** LLM 설정으로 ChatOpenAI 인스턴스 생성 (LangGraph 에이전트용). */
  private getLangChainModel(model?: string): ChatOpenAI {
    const defaultConfig = this.llmStore.findDefault();
    if (!defaultConfig) {
      throw new Error(
        "LLM 설정이 없습니다. LLM 관리 페이지에서 설정을 추가해주세요.",
      );
    }
    const modelId = model ?? defaultConfig.model;
    return new ChatOpenAI({
      model: modelId,
      apiKey: defaultConfig.apiKey || "not-needed",
      configuration: defaultConfig.baseURL
        ? { baseURL: defaultConfig.baseURL }
        : undefined,
    });
  }

  /** MCP 도구 목록을 LangChain 도구 배열로 반환 (LangGraph ToolNode용). */
  private async getMcpToolsAsLangChain(): Promise<StructuredToolInterface[]> {
    const servers = this.mcpStore.findAll();
    const tools: StructuredToolInterface[] = [];
    const seen = new Set<string>();
    for (const server of servers) {
      const result = await listToolsFromMcpServer(server);
      for (const t of result.tools) {
        if (seen.has(t.name)) continue;
        seen.add(t.name);
        const toolName = t.name;
        tools.push(
          tool(
            async (args: Record<string, unknown>) => {
              return this.executeToolCall(toolName, args ?? {});
            },
            {
              name: t.name,
              description: t.description ?? "",
              schema: z.record(z.unknown()),
            },
          ) as StructuredToolInterface,
        );
      }
    }
    return tools;
  }

  /** LangGraph 기반 에이전트 그래프 생성 (도구 없이도 동작). */
  private createAgentGraph(
    llm: ChatOpenAI,
    mcpTools: StructuredToolInterface[],
    systemPrompt: string,
  ) {
    const systemMessage = new SystemMessage({ content: systemPrompt });

    const callModel = async (state: { messages: BaseMessage[] }) => {
      const messages = [systemMessage, ...state.messages];
      const modelWithTools =
        mcpTools.length > 0 ? llm.bindTools(mcpTools) : llm;
      const response = await modelWithTools.invoke(
        messages as unknown as Parameters<typeof modelWithTools.invoke>[0],
      );
      return { messages: [response as unknown as BaseMessage] };
    };

    const graph = new StateGraph(MessagesAnnotation)
      .addNode("model", callModel)
      .addNode("tools", new ToolNode(mcpTools))
      .addEdge(START, "model")
      .addConditionalEdges("model", toolsCondition)
      .addEdge("tools", "model");

    return graph.compile();
  }

  async chat(
    options: AgentChatOptions,
    onEvent?: (event: AgentEvent) => void,
  ): Promise<AgentChatResult> {
    const defaultConfig = this.llmStore.findDefault();
    const defaultModel = defaultConfig?.model || "gpt-4o-mini";
    const { messages, model = defaultModel } = options;

    const llm = this.getLangChainModel(model);
    const mcpTools = await this.getMcpToolsAsLangChain();

    const systemPrompt = `You are a helpful assistant named MagicClaw.
You have access to tools (via MCP) to perform actions when necessary.
Always reason about the user's intent and choose whether tools are actually needed.
Reply in the same language as the user when appropriate.`;

    const agent = this.createAgentGraph(llm, mcpTools, systemPrompt);

    const lcMessages: BaseMessage[] = messages.map((m) => {
      if (m.role === "system") return new SystemMessage({ content: m.content });
      if (m.role === "user") return new HumanMessage({ content: m.content });
      return new AIMessage({ content: m.content });
    });

    const result = await agent.invoke({
      messages: lcMessages,
    });

    const toolCallsLog: ToolCallEntry[] = [];
    let toolCallsUsed = 0;
    let finalMessage = "";

    const resultMessages =
      (result as { messages?: BaseMessage[] }).messages ?? [];
    for (let i = 0; i < resultMessages.length; i++) {
      const msg = resultMessages[i];
      if (msg instanceof AIMessage) {
        const content =
          typeof msg.content === "string"
            ? msg.content
            : Array.isArray(msg.content)
              ? (msg.content as { type?: string; text?: string }[])
                  .filter(
                    (c) => c.type === "text" && typeof c.text === "string",
                  )
                  .map((c) => c.text)
                  .join("")
              : "";
        if (content && onEvent) {
          onEvent({ type: "assistant_message", content });
        }
        const toolCalls = msg.tool_calls ?? [];
        for (let j = 0; j < toolCalls.length; j++) {
          const tc = toolCalls[j];
          const name = tc.name ?? "";
          const args = (tc.args ?? {}) as Record<string, unknown>;
          toolCallsLog.push({ name, args });
          toolCallsUsed++;
          if (onEvent && name) {
            onEvent({ type: "tool_call", name, args });
          }
          const toolMsg = resultMessages[i + 1 + j];
          const output =
            toolMsg && "content" in toolMsg
              ? typeof toolMsg.content === "string"
                ? toolMsg.content
                : String(toolMsg.content ?? "")
              : "";
          if (onEvent && name) {
            onEvent({ type: "tool_result", name, output });
          }
        }
        if (toolCalls.length > 0) {
          i += toolCalls.length - 1; // 다음 루프에서 i++ 되므로 ToolMessage들만 건너뜀
        } else if (content) {
          finalMessage = content;
        }
      }
    }

    if (!finalMessage) {
      const last = resultMessages[resultMessages.length - 1];
      if (last && "content" in last) {
        finalMessage =
          typeof last.content === "string"
            ? last.content
            : Array.isArray(last.content)
              ? (last.content as { text?: string }[])
                  .filter((c) => c && typeof c.text === "string")
                  .map((c) => c.text)
                  .join("")
              : "";
      }
    }
    if (!finalMessage) {
      finalMessage = "응답을 생성하지 못했습니다.";
    }

    const agentResult: AgentChatResult = {
      message: finalMessage,
      toolCallsUsed,
      toolCalls: toolCallsLog,
    };

    if (onEvent) {
      onEvent({
        type: "final_message",
        message: agentResult.message,
        toolCallsUsed: agentResult.toolCallsUsed,
        toolCalls: agentResult.toolCalls,
      });
    }

    return agentResult;
  }
}
