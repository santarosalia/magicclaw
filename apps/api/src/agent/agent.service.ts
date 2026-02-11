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
  private openai: OpenAI | null = null;
  private toolServerCache = new Map<string, McpServerConfig>();
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

  async chat(
    options: AgentChatOptions,
    onEvent?: (event: AgentEvent) => void
  ): Promise<AgentChatResult> {
    const defaultConfig = this.llmStore.findDefault();
    const defaultModel = defaultConfig?.model || "gpt-4o-mini";
    const { messages, model = defaultModel, maxToolRounds = 2000 } = options;

    const openaiClient = this.getOpenAIClient(model);

    const mcpTools = await this.getMcpToolsAsOpenAI();
    const systemMessage: OpenAI.Chat.ChatCompletionMessageParam = {
      role: "system",
      content: `You are a helpful assistant named MagicClaw.
You have access to tools (via MCP) to perform actions when necessary.
Always reason about the user's intent and choose whether tools are actually needed.
Reply in the same language as the user when appropriate.`,
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

    // 계획이 수립된 경우, 각 단계별로 LLM을 태우기 위해 steps를 유지한다.
    let executionSteps: string[] | null = null;

    // onEvent 콜백이 있는 경우(예: WebSocket 스트리밍)에는 먼저
    // "계획 수립이 필요한지"를 판단하고, 필요한 경우에만 numbered plan을 만든다.
    if (onEvent) {
      try {
        const lastUserMessage = [...messages]
          .reverse()
          .find((m) => m.role === "user");

        if (lastUserMessage) {
          const planningMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
            {
              role: "system",
              content: `You are a planner and intent classifier.
Given the latest user request, decide if step-by-step planning is helpful.

Respond ONLY with strict JSON, no explanations:
{"needPlan": boolean, "steps": string[]}

- "needPlan": true if the task involves multiple steps, tool usage, browsing, or non-trivial procedures.
- "needPlan": false for simple Q&A or very short answers that don't need tools.
- "steps": a short numbered list of high-level steps (in the user's language) ONLY when needPlan is true.
If needPlan is false, you may return an empty array for steps.`,
            },
            {
              role: "user",
              content: lastUserMessage.content,
            },
          ];

          const planningCompletion =
            await openaiClient.chat.completions.create({
              model,
              messages: planningMessages,
              tools: undefined,
              tool_choice: "none",
              max_tokens: 400,
            });

          const planningChoice = planningCompletion.choices[0];
          const planningMsg = planningChoice?.message;
          const raw = planningMsg?.content as
            | string
            | Array<{ type?: string; text?: string }>
            | null
            | undefined;

          const textContent =
            typeof raw === "string"
              ? raw
              : Array.isArray(raw)
              ? raw
                  .filter(
                    (c) =>
                      c.type === "text" && typeof (c as any).text === "string"
                  )
                  .map((c: any) => c.text as string)
                  .join("")
              : "";

          if (textContent) {
            let needPlan = false;
            let steps: string[] = [];
            try {
              const parsed = JSON.parse(textContent) as {
                needPlan?: boolean;
                steps?: unknown;
              };
              needPlan = !!parsed.needPlan;
              if (Array.isArray(parsed.steps)) {
                steps = parsed.steps.filter(
                  (s): s is string => typeof s === "string" && s.trim().length > 0
                );
              }
            } catch {
              // JSON 파싱 실패 시에는 보수적으로 계획 수립을 건너뜀
            }

            if (needPlan && steps.length > 0) {
              executionSteps = steps;
              const numberedPlan = steps
                .map((s, idx) => `${idx + 1}. ${s}`)
                .join("\n");

              onEvent({
                type: "assistant_message",
                content: numberedPlan,
              });

              // 이후 실행 단계에서도 이 계획이 컨텍스트에 포함되도록 assistant 메시지로 추가
              openaiMessages.push({
                role: "assistant",
                content: numberedPlan,
              });
            }
          }
        }
      } catch {
        // 계획 수립 호출이 실패해도 메인 루프는 그대로 진행
      }
    }

    const toolCallsLog: ToolCallEntry[] = [];
    let toolCallsUsed = 0;
    let round = 0;

    // 하나의 "실행 단계"를 처리하는 공통 루프
    const runStep = async (
      stepInstruction: string | null,
      finalizeOnCompletion: boolean
    ): Promise<{ completed: boolean; result?: AgentChatResult; lastContent: string }> => {
      let lastContent = "";

      // 각 단계 시작 시, 현재 단계에 대한 간단한 안내 메시지를 LLM에 컨텍스트로 전달
      if (stepInstruction) {
        openaiMessages.push({
          role: "assistant",
          content: `지금은 다음 계획의 한 단계를 실행합니다:\n${stepInstruction}\n\n이 단계에 필요한 도구만 사용하고, 이 단계가 끝나면 이 단계에서 수행한 작업과 결과만 간단히 설명하세요. 다음 단계의 작업은 하지 마세요.`,
        });
      }

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
          const fallback: AgentChatResult = {
            message: "No response from model.",
            toolCallsUsed,
            toolCalls: toolCallsLog,
          };
          if (finalizeOnCompletion && onEvent) {
            onEvent({
              type: "final_message",
              message: fallback.message,
              toolCallsUsed: fallback.toolCallsUsed,
              toolCalls: fallback.toolCalls,
            });
          }
          return { completed: true, result: fallback, lastContent: fallback.message };
        }

        const msg = choice.message;
        openaiMessages.push(msg);

        const toolCalls = msg.tool_calls;

        // 중간 assistant 메시지(계획/단계 설명 등)를 프론트로 전달
        if (onEvent && toolCalls?.length) {
          const rawContent = msg.content as
            | string
            | Array<{ type?: string; text?: string }>
            | null
            | undefined;

          const content =
            typeof rawContent === "string"
              ? rawContent
              : Array.isArray(rawContent)
              ? rawContent
                  .filter((c) => c.type === "text" && typeof c.text === "string")
                  .map((c) => c.text)
                  .join("")
              : "";

          if (content) {
            onEvent({
              type: "assistant_message",
              content,
            });
          }
        }

        // tool_calls가 없으면 이 단계의 자연어 응답이 나온 것
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
              ? JSON.stringify(raw)
              : "";

          lastContent = content;

          if (finalizeOnCompletion) {
            const result: AgentChatResult = {
              message: content,
              toolCallsUsed,
              toolCalls: toolCallsLog,
            };

            if (onEvent) {
              onEvent({
                type: "final_message",
                message: result.message,
                toolCallsUsed: result.toolCallsUsed,
                toolCalls: result.toolCalls,
              });
            }

            return { completed: true, result, lastContent: content };
          }

          // 중간 단계라면, 단계 결과를 assistant_message로만 보내고 다음 스텝으로 진행
          if (onEvent && content) {
            onEvent({
              type: "assistant_message",
              content,
            });
          }

          return { completed: true, lastContent: content };
        }

        // tool_calls가 있는 경우: MCP 도구 실행
        for (const tc of toolCalls) {
          const name = tc.function?.name ?? "";
          let args: Record<string, unknown> = {};
          try {
            if (tc.function?.arguments) args = JSON.parse(tc.function.arguments);
          } catch {
            // ignore
          }
          toolCallsLog.push({ name, args });

          if (onEvent && name) {
            onEvent({
              type: "tool_call",
              name,
              args,
            });
          }

          const result = await this.executeToolCall(name, args);

          if (onEvent && name) {
            onEvent({
              type: "tool_result",
              name,
              output: result,
            });
          }

          toolCallsUsed++;
          openaiMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: result,
          });
        }

        round++;
      }

      // 루프가 maxToolRounds에 도달한 경우
      const fallback: AgentChatResult = {
        message: lastContent || "Max tool rounds reached; ending turn.",
        toolCallsUsed,
        toolCalls: toolCallsLog,
      };
      if (finalizeOnCompletion && onEvent) {
        onEvent({
          type: "final_message",
          message: fallback.message,
          toolCallsUsed: fallback.toolCallsUsed,
          toolCalls: fallback.toolCalls,
        });
      }
      return { completed: true, result: finalizeOnCompletion ? fallback : undefined, lastContent: fallback.message };
    };

    // 계획이 수립된 경우: 각 플랜 스텝마다 runStep을 한 번씩 실행
    if (executionSteps && executionSteps.length > 0 && onEvent) {
      let lastContent = "";

      for (let i = 0; i < executionSteps.length; i++) {
        const isLastStep = i === executionSteps.length - 1;
        const { result, lastContent: stepContent } = await runStep(
          executionSteps[i],
          isLastStep
        );
        lastContent = stepContent;

        if (result) {
          // 마지막 스텝에서 final_message까지 이미 전송된 상태
          return result;
        }
      }

      // 이론상 도달하지 않지만, 안전장치로 최종 결과 생성
      const fallback: AgentChatResult = {
        message: lastContent || "Max tool rounds reached; ending turn.",
        toolCallsUsed,
        toolCalls: toolCallsLog,
      };
      if (onEvent) {
        onEvent({
          type: "final_message",
          message: fallback.message,
          toolCallsUsed: fallback.toolCallsUsed,
          toolCalls: fallback.toolCalls,
        });
      }
      return fallback;
    }

    // 계획이 없거나(onEvent가 없는 HTTP 요청 등) 단일 단계로 처리할 때: 기존과 동일하게 한 번의 runStep으로 처리
    const { result } = await runStep(null, true);
    // runStep에서 항상 result를 채워주므로 non-null 단언
    return result as AgentChatResult;
  }
}
