import { Injectable } from "@nestjs/common";
import OpenAI from "openai";
import type { McpServerConfig } from "../mcp/dto/mcp-server.dto.js";
import {
  callMcpTool,
  listToolsFromMcpServer,
} from "../mcp/mcp-client.service.js";
import { McpStoreService } from "../mcp/mcp-store.service.js";
import { LlmStoreService } from "../llm/llm-store.service.js";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface AgentChatOptions {
  messages: ChatMessage[];
  model?: string;
  maxToolRounds?: number;
}

export interface AgentChatResult {
  message: string;
  toolCallsUsed: number;
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
  private openai: OpenAI | null = null;

  constructor(
    private readonly mcpStore: McpStoreService,
    private readonly llmStore: LlmStoreService
  ) {
    const key = process.env.OPENAI_API_KEY;
    if (key) this.openai = new OpenAI({ apiKey: key });
  }

  private getOpenAIClient(model?: string): OpenAI {
    // 로컬 LLM 설정이 있으면 사용
    const defaultConfig = this.llmStore.findDefault();
    if (defaultConfig) {
      return new OpenAI({
        baseURL: defaultConfig.baseURL,
        apiKey: defaultConfig.apiKey || "not-needed",
      });
    }

    // 환경변수에서 OpenAI 키가 있으면 사용
    if (this.openai) {
      return this.openai;
    }

    throw new Error(
      "LLM 설정이 없습니다. LLM 관리 페이지에서 설정을 추가해주세요."
    );
  }

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
  private async findServerForTool(
    toolName: string
  ): Promise<McpServerConfig | undefined> {
    const servers = this.mcpStore.findAll();
    for (const server of servers) {
      const result = await listToolsFromMcpServer(server);
      if (result.tools.some((t) => t.name === toolName)) return server;
    }
    return undefined;
  }

  /** Execute one tool call via MCP and return content for the assistant message. */
  private async executeToolCall(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<string> {
    const server = await this.findServerForTool(toolName);
    if (!server) return `Error: No MCP server provides tool "${toolName}"`;
    const result = await callMcpTool(server, toolName, args);
    const texts = result.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text);
    return texts.join("\n");
  }

  async chat(options: AgentChatOptions): Promise<AgentChatResult> {
    const defaultConfig = this.llmStore.findDefault();
    const defaultModel = defaultConfig?.model || "gpt-4o-mini";
    const { messages, model = defaultModel, maxToolRounds = 5 } = options;

    const openaiClient = this.getOpenAIClient(model);

    const mcpTools = await this.getMcpToolsAsOpenAI();
    const systemMessage: OpenAI.Chat.ChatCompletionMessageParam = {
      role: "system",
      content:
        "You are a helpful assistant. When you need to perform actions (search, read files, etc.), use the provided tools. Reply in the same language as the user when appropriate.",
    };
    const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      systemMessage,
      ...messages.map((m) =>
        m.role === "system"
          ? { role: "system" as const, content: m.content }
          : m.role === "user"
          ? { role: "user" as const, content: m.content }
          : { role: "assistant" as const, content: m.content }
      ),
    ];

    let toolCallsUsed = 0;
    let round = 0;

    while (round < maxToolRounds) {
      const completion = await openaiClient.chat.completions.create({
        model,
        messages: openaiMessages,
        tools: mcpTools.length > 0 ? mcpTools : undefined,
        tool_choice: mcpTools.length > 0 ? "auto" : undefined,
      });
      console.log("completion", completion);

      const choice = completion.choices[0];
      if (!choice?.message) {
        return {
          message: "No response from model.",
          toolCallsUsed,
        };
      }

      const msg = choice.message;
      openaiMessages.push(msg);

      const toolCalls = msg.tool_calls;
      if (!toolCalls?.length) {
        const raw = msg.content as
          | string
          | Array<{ type?: string; text?: string }>
          | null
          | undefined;
        const content =
          typeof raw === "string"
            ? raw
            : Array.isArray(raw)
            ? raw.map((c) => (c.type === "text" ? c.text ?? "" : "")).join("")
            : "";
        return { message: content, toolCallsUsed };
      }

      for (const tc of toolCalls) {
        const name = tc.function?.name ?? "";
        let args: Record<string, unknown> = {};
        try {
          if (tc.function?.arguments) args = JSON.parse(tc.function.arguments);
        } catch {
          // ignore
        }
        const result = await this.executeToolCall(name, args);
        toolCallsUsed++;
        openaiMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: result,
        });
      }
      round++;
    }

    return {
      message: "Max tool rounds reached; ending turn.",
      toolCallsUsed,
    };
  }
}
