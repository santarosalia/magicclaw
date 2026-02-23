import { Injectable } from "@nestjs/common";
import {
  listToolsFromMcpServer,
  getMcpToolsAsLangChain,
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
import { createAgent } from "langchain";
import type { StructuredToolInterface } from "@langchain/core/tools";

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

/** ChatMessage[] → LangChain BaseMessage[] (API 입력을 그래프 state 형식으로). */
function chatMessagesToLangChain(messages: ChatMessage[]): BaseMessage[] {
  return messages.map((m) => {
    if (m.role === "system") return new SystemMessage({ content: m.content });
    if (m.role === "user") return new HumanMessage({ content: m.content });
    return new AIMessage({ content: m.content });
  });
}

/** BaseMessage content를 string으로 추출 (string | MessageContentBlock[] 지원). */
function getMessageContentAsString(msg: BaseMessage): string {
  const c = msg.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return (c as { type?: string; text?: string }[])
      .filter((x) => x.type === "text" && typeof x.text === "string")
      .map((x) => x.text)
      .join("");
  }
  return "";
}

/** result.messages에서 툴 호출 로그와 최종 응답 텍스트 추출. 스트리밍 시 startIndex로 신규 메시지만 처리해 onEvent 발송. */
function processResultMessages(
  messages: BaseMessage[],
  opts?: { onEvent?: (event: AgentEvent) => void; startIndex?: number }
): {
  toolCallsLog: ToolCallEntry[];
  toolCallsUsed: number;
  finalMessage: string;
} {
  const toolCallsLog: ToolCallEntry[] = [];
  let toolCallsUsed = 0;
  let finalMessage = "";
  const start = opts?.startIndex ?? 0;
  for (let i = start; i < messages.length; i++) {
    const msg = messages[i];
    if (msg instanceof AIMessage) {
      const content = getMessageContentAsString(msg);
      if (content && opts?.onEvent)
        opts.onEvent({ type: "assistant_message", content });
      const toolCalls = msg.tool_calls ?? [];
      for (let j = 0; j < toolCalls.length; j++) {
        const tc = toolCalls[j];
        const name = tc.name ?? "";
        const args = (tc.args ?? {}) as Record<string, unknown>;
        toolCallsLog.push({ name, args });
        toolCallsUsed++;
        if (opts?.onEvent && name)
          opts.onEvent({ type: "tool_call", name, args });
        const toolMsg = messages[i + 1 + j];
        const output =
          toolMsg && "content" in toolMsg
            ? getMessageContentAsString(toolMsg as BaseMessage)
            : "";
        if (opts?.onEvent && name)
          opts.onEvent({ type: "tool_result", name, output });
      }
      if (toolCalls.length > 0) {
        i += toolCalls.length - 1;
      } else if (content) {
        finalMessage = content;
      }
    }
  }
  if (!finalMessage && messages.length > 0) {
    const last = messages[messages.length - 1];
    if (last && "content" in last)
      finalMessage = getMessageContentAsString(last as BaseMessage);
  }
  return { toolCallsLog, toolCallsUsed, finalMessage };
}

@Injectable()
export class AgentService {
  constructor(
    private readonly mcpStore: McpStoreService,
    private readonly llmStore: LlmStoreService
  ) {}

  /** 등록된 MCP 서버에서 도구 목록만 반환 (API 목록용). */
  async getMcpToolsList(): Promise<{ name: string; description?: string }[]> {
    const servers = this.mcpStore.findAll();
    const seen = new Set<string>();
    const tools: { name: string; description?: string }[] = [];
    for (const server of servers) {
      const result = await listToolsFromMcpServer(server);
      for (const t of result.tools) {
        if (seen.has(t.name)) continue;
        seen.add(t.name);
        tools.push({ name: t.name, description: t.description });
      }
    }
    return tools;
  }

  /** LLM 설정으로 ChatOpenAI 인스턴스 생성 (LangGraph 에이전트용). */
  private getLangChainModel(model?: string): ChatOpenAI {
    const defaultConfig = this.llmStore.findDefault();
    if (!defaultConfig) {
      throw new Error(
        "LLM 설정이 없습니다. LLM 관리 페이지에서 설정을 추가해주세요."
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

  /** MCP 클라이언트 서비스를 통해 LangChain 도구 반환. 사용 후 close() 호출 필요. */
  private async getMcpToolsAsLangChain(): Promise<{
    tools: StructuredToolInterface[];
    close: () => Promise<void>;
  }> {
    const servers = this.mcpStore.findAll();
    return getMcpToolsAsLangChain(servers);
  }

  async chat(
    options: AgentChatOptions,
    onEvent?: (event: AgentEvent) => void
  ): Promise<AgentChatResult> {
    const defaultConfig = this.llmStore.findDefault();
    const defaultModel = defaultConfig?.model || "gpt-4o-mini";
    const { messages, model = defaultModel } = options;

    const llm = this.getLangChainModel(model);
    const { tools, close: closeMcp } = await this.getMcpToolsAsLangChain();

    try {
      const systemPrompt = `You are a helpful assistant named MagicClaw.
You have access to tools (via MCP) to perform actions when necessary.
Always reason about the user's intent and choose whether tools are actually needed.
Reply in the same language as the user when appropriate.`;

      const agent = createAgent({
        model: llm,
        tools,
        systemPrompt,
      });

      const lcMessages = chatMessagesToLangChain(messages);

      let resultMessages: BaseMessage[] = [];

      if (onEvent) {
        const stream = await agent.stream(
          { messages: lcMessages },
          { streamMode: "values" }
        );
        let prevLen = 0;
        let lastEmittedContentLength = 0;
        for await (const chunk of stream) {
          const chunkMessages =
            (chunk as { messages?: BaseMessage[] }).messages ?? [];
          // assistant 텍스트는 증분만 전송 (이전 내용 반복 방지)
          const lastMsg = chunkMessages[chunkMessages.length - 1];
          if (lastMsg instanceof AIMessage) {
            const content = getMessageContentAsString(lastMsg);
            if (content.length > lastEmittedContentLength) {
              onEvent({
                type: "assistant_message",
                content: content.slice(lastEmittedContentLength),
              });
              lastEmittedContentLength = content.length;
            }
          } else {
            // ToolMessage 등으로 바뀌면 다음 AIMessage에서 다시 누적
            lastEmittedContentLength = 0;
          }
          // tool_call / tool_result는 신규 메시지만 처리
          processResultMessages(chunkMessages, {
            onEvent: (e) => {
              if (e.type !== "assistant_message") onEvent(e);
            },
            startIndex: prevLen,
          });
          prevLen = chunkMessages.length;
          resultMessages = chunkMessages;
        }
      } else {
        const result = await agent.invoke({ messages: lcMessages });
        resultMessages =
          (result as { messages?: BaseMessage[] }).messages ?? [];
      }

      const {
        toolCallsLog,
        toolCallsUsed,
        finalMessage: rawFinal,
      } = processResultMessages(resultMessages);
      const finalMessage = rawFinal || "응답을 생성하지 못했습니다.";

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
    } finally {
      await closeMcp();
    }
  }
}
