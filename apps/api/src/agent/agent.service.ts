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

/** 계획 단계: 설명 + (선택) 사용할 MCP 서버 이름 */
export interface PlanStepInfo {
  description: string;
  server?: string;
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

  /** 서버 이름에 해당하는 MCP 서버의 도구만 반환 (계획 단계별 도구 제한용). */
  private async getMcpToolsForServer(
    serverName: string
  ): Promise<OpenAI.Chat.Completions.ChatCompletionTool[]> {
    const servers = this.mcpStore.findAll();
    const server = servers.find(
      (s) => s.name.trim().toLowerCase() === serverName.trim().toLowerCase()
    );
    if (!server) return [];
    const result = await listToolsFromMcpServer(server);
    return result.tools.map((t) => mcpToolToOpenAI(t));
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
    let executionSteps: PlanStepInfo[] | null = null;

    // 등록된 MCP 서버 목록 (이름만) — 계획 수립 시 단계별로 어떤 서버를 쓸지 고르게 함
    const mcpServerList = this.mcpStore
      .findAll()
      .map((s) => s.name)
      .filter((n) => n.trim().length > 0);

    // onEvent 콜백이 있는 경우(예: WebSocket 스트리밍)에는 먼저
    // "계획 수립이 필요한지"를 판단하고, 필요한 경우에만 numbered plan을 만든다.
    if (onEvent) {
      try {
        const lastUserMessage = [...messages]
          .reverse()
          .find((m) => m.role === "user");

        if (lastUserMessage) {
          const serverListText =
            mcpServerList.length > 0
              ? `\n\nAvailable MCP servers (use exact name in "server" when relevant):\n${mcpServerList
                  .map((n) => `- ${n}`)
                  .join("\n")}`
              : "";

          const planningMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
            {
              role: "system",
              content: `You are a planner and intent classifier.
Given the latest user request, decide if step-by-step planning is helpful.${serverListText}

Respond ONLY with strict JSON, no explanations:
{"needPlan": boolean, "steps": Array<{description: string, server?: string}>}

- "needPlan": true if the task involves multiple steps, tool usage, browsing, or non-trivial procedures.
- "needPlan": false for simple Q&A or very short answers that don't need tools.
- "steps": when needPlan is true, list each step as an object with "description" (short step in user's language) and optionally "server" (exact MCP server name from the list above for that step). If a step does not need a specific server, omit "server".
If needPlan is false, return an empty array for steps.`,
            },
            {
              role: "user",
              content: lastUserMessage.content,
            },
          ];

          const planningCompletion = await openaiClient.chat.completions.create(
            {
              model,
              messages: planningMessages,
              tools: undefined,
              tool_choice: "none",
              max_tokens: 400,
            }
          );

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
            let steps: PlanStepInfo[] = [];
            try {
              const parsed = JSON.parse(textContent) as {
                needPlan?: boolean;
                steps?: unknown;
              };
              needPlan = !!parsed.needPlan;
              if (Array.isArray(parsed.steps)) {
                steps = parsed.steps
                  .map((s: unknown): PlanStepInfo | null => {
                    if (typeof s === "string" && s.trim().length > 0)
                      return { description: s.trim() };
                    if (
                      s &&
                      typeof s === "object" &&
                      "description" in s &&
                      typeof (s as { description: unknown }).description ===
                        "string"
                    ) {
                      const d = (s as { description: string; server?: string })
                        .description;
                      const server = (s as { server?: string }).server;
                      if (d.trim().length > 0)
                        return {
                          description: d.trim(),
                          server:
                            typeof server === "string" &&
                            server.trim().length > 0
                              ? server.trim()
                              : undefined,
                        };
                    }
                    return null;
                  })
                  .filter((s): s is PlanStepInfo => s !== null);
              }
            } catch {
              // JSON 파싱 실패 시에는 보수적으로 계획 수립을 건너뜀
            }

            if (needPlan && steps.length > 0) {
              executionSteps = steps;
              const numberedPlan = steps
                .map(
                  (s, idx) =>
                    `${idx + 1}. ${s.description}${
                      s.server ? ` (서버: ${s.server})` : ""
                    }`
                )
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
      stepInfo: PlanStepInfo | null,
      stepIndex: number,
      allSteps: PlanStepInfo[],
      finalizeOnCompletion: boolean,
      previousStepResult?: string
    ): Promise<{
      completed: boolean;
      result?: AgentChatResult;
      lastContent: string;
    }> => {
      let lastContent = "";

      // 2단계부터: 이전 단계 결과를 명시적으로 넣어서 이번 단계에서 활용하도록 함
      if (previousStepResult?.trim()) {
        openaiMessages.push({
          role: "user",
          content: `[이전 단계 결과]\n${previousStepResult.trim()}\n\n위 결과를 활용하여 다음 단계를 수행하세요.`,
        });
      }

      // 단계별 실행 시: "현재 단계 하나만" 수행하도록 엄격한 지시를 LLM 컨텍스트에 추가
      if (stepInfo && allSteps.length > 0) {
        const nextStepsList =
          stepIndex + 1 < allSteps.length
            ? allSteps
                .slice(stepIndex + 1)
                .map(
                  (s, j) =>
                    `${j + 1}. ${s.description}${
                      s.server ? ` (서버: ${s.server})` : ""
                    }`
                )
                .join("\n")
            : "(없음)";

        const serverHint = stepInfo.server
          ? `\n- **이 단계에서 사용할 MCP 서버:** ${stepInfo.server} — 이 단계는 반드시 "${stepInfo.server}" 서버의 도구를 호출해서 완료해야 합니다. "차후에 진행하겠다"고만 하지 말고, 지금 해당 도구를 호출하세요.`
          : "";

        openaiMessages.push({
          role: "assistant",
          content: `[단계별 실행 규칙 - 반드시 지킬 것]
지금은 **현재 단계 하나만** 수행합니다. 다음 단계의 작업은 이 턴에서 절대 하지 마세요.

- **현재 단계(지금 할 일):** ${stepInfo.description}${serverHint}
- **다음 단계(아직 하지 말 것):**
${nextStepsList}

규칙:
1. 위 "현재 단계"에 해당하는 도구만 호출하세요. (예: 1단계가 "주가 조회"면 검색/조회 도구만, 2단계가 "엑셀 생성"이면 그때 파일·엑셀 도구 사용)
2. 다음 단계에 해당하는 도구(파일 생성, 엑셀 작성, 저장, 링크 제공 등)는 현재 단계에서 호출하지 마세요.
3. 이 단계가 끝나면 수행한 내용만 한두 문장으로 보고하고, 추가 도구 호출 없이 종료하세요.`,
        });
      }

      // 서버가 지정된 단계에서는 해당 서버의 도구만 전달 → "차후 진행" 없이 반드시 그 도구를 쓰게 함
      let toolsForStep = mcpTools;
      if (stepInfo?.server) {
        const serverTools = await this.getMcpToolsForServer(stepInfo.server);
        if (serverTools.length > 0) toolsForStep = serverTools;
      }

      while (round < maxToolRounds) {
        const completion = await openaiClient.chat.completions.create({
          model,
          messages: openaiMessages,
          tools: toolsForStep.length > 0 ? toolsForStep : undefined,
          tool_choice: toolsForStep.length > 0 ? "auto" : undefined,
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
          return {
            completed: true,
            result: fallback,
            lastContent: fallback.message,
          };
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
                  .filter(
                    (c) => c.type === "text" && typeof c.text === "string"
                  )
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
            if (tc.function?.arguments)
              args = JSON.parse(tc.function.arguments);
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
      return {
        completed: true,
        result: finalizeOnCompletion ? fallback : undefined,
        lastContent: fallback.message,
      };
    };

    // 계획이 수립된 경우: 각 플랜 스텝마다 runStep을 한 번씩 실행
    if (executionSteps && executionSteps.length > 0 && onEvent) {
      let lastContent = "";

      for (let i = 0; i < executionSteps.length; i++) {
        const step = executionSteps[i];
        const stepLabel =
          step.description + (step.server ? ` (서버: ${step.server})` : "");
        const isLastStep = i === executionSteps.length - 1;

        // 단계 시작 시 즉시 프론트로 "단계 N" 메시지 전송 (단계별로 보이도록)
        onEvent({
          type: "assistant_message",
          content: `[단계 ${i + 1}/${executionSteps.length}] ${stepLabel}`,
        });

        const { result, lastContent: stepContent } = await runStep(
          step,
          i,
          executionSteps,
          isLastStep,
          i >= 1 ? lastContent : undefined
        );
        lastContent = stepContent;

        // 중간 단계에서 LLM이 텍스트를 안 냈으면 대체 메시지로 단계 완료 알림
        if (!result && !stepContent) {
          onEvent({
            type: "assistant_message",
            content: `→ 단계 ${i + 1} 완료: ${step.description}`,
          });
        }

        // 다음 단계 전에 프론트가 렌더링할 수 있도록 짧은 대기
        if (!result) {
          await new Promise((r) => setTimeout(r, 80));
        }

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
    const { result } = await runStep(null, 0, [], true, undefined);
    // runStep에서 항상 result를 채워주므로 non-null 단언
    return result as AgentChatResult;
  }
}
