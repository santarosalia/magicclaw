import { Injectable } from "@nestjs/common";
import {
  listToolsFromMcpServer,
  getMcpToolsAsLangChain,
} from "../mcp/mcp-client.service.js";
import { McpStoreService } from "../mcp/mcp-store.service.js";
import { LlmStoreService } from "../llm/llm-store.service.js";
import { ChatOpenAI } from "@langchain/openai";
import {
  StateGraph,
  Annotation,
  messagesStateReducer,
  START,
  END,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import type { StructuredToolInterface } from "@langchain/core/tools";
import {
  ToolMessage,
  SystemMessage,
  AIMessage,
  HumanMessage,
  BaseMessage,
  ToolCall,
} from "langchain";

/** 플랜 텍스트를 번호/불릿 기준으로 단계 배열로 파싱. */
function parsePlanSteps(planText: string): string[] {
  const trimmed = planText.trim();
  if (!trimmed) return [];
  const lines = trimmed
    .split(/\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const steps = lines.map((line) =>
    line.replace(/^\s*(\d+[.)]\s*|[\-\*]\s+)/i, "").trim()
  );
  return steps.length > 0 ? steps : [trimmed];
}

/** 플래닝 에이전트용 state: messages + 라우터 판단 + 단계별 계획 + 현재 단계 인덱스. */
const PlanStateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  isMultiStep: Annotation<boolean>(),
  planSteps: Annotation<string[]>(),
  currentStepIndex: Annotation<number>(),
});
type PlanState = typeof PlanStateAnnotation.State;

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface AgentChatOptions {
  messages: ChatMessage[];
  model?: string;
}

export type AgentEvent =
  | { type: "plan"; content: string }
  | {
      type: "tool_call";
      toolCall: ToolCall;
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
      type: "tool_message";
      toolMessage: ToolMessage;
    }
  | {
      type: "final_message";
      message: string;
      toolCallsUsed: number;
      toolCalls: ToolCall[];
    };

export interface AgentChatResult {
  message: string;
  toolCallsUsed: number;
  toolCalls: ToolCall[];
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
  toolCallsLog: ToolCall[];
  toolCallsUsed: number;
  finalMessage: string;
} {
  const toolCallsLog: ToolCall[] = [];
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
        const toolCall = toolCalls[j] as ToolCall;

        toolCallsLog.push(toolCall);
        toolCallsUsed++;
        if (opts?.onEvent) opts.onEvent({ type: "tool_call", toolCall });
      }

      if (toolCalls.length > 0) {
        i += toolCalls.length - 1;
      } else if (content) {
        finalMessage = content;
      }
    }

    if (msg instanceof ToolMessage) {
      if (opts?.onEvent) {
        opts.onEvent({ type: "tool_message", toolMessage: msg });
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

  /** LangGraph StateGraph: router → (단순: agent_direct | 단계: planner → agent) + 공용 tools. */
  private buildAgentGraph(
    llm: ChatOpenAI,
    tools: StructuredToolInterface[],
    systemPrompt: string
  ) {
    const routerPrompt = `You are a task classifier. Based on the user's latest message, decide if the task is:
- SIMPLE: one or two quick actions (e.g. single search, one click, one query). Reply with exactly: SIMPLE
- MULTI_STEP: requires a clear sequence of several steps (e.g. open page, then search, then copy, then paste elsewhere). Reply with exactly: MULTI_STEP

Reply with only one word: SIMPLE or MULTI_STEP.`;

    const routerNode = async (state: PlanState) => {
      const withSystem = [
        new SystemMessage({ content: routerPrompt }),
        ...state.messages,
      ];
      const response = await llm.invoke(withSystem);
      const text = getMessageContentAsString(response).trim().toUpperCase();
      const isMultiStep =
        text.includes("MULTI") ||
        text === "MULTI_STEP" ||
        text.startsWith("MULTI");
      return { isMultiStep };
    };

    const planPrompt = `You are a planning assistant. Based on the conversation, create a brief step-by-step plan to fulfill the user's request. Use the same language as the user. Output one step per line, each line starting with "1. ", "2. ", etc. If the request is simple, output a single step. Output ONLY the plan, no other text or tools.`;

    const plannerNode = async (state: PlanState) => {
      const withSystem = [
        new SystemMessage({ content: planPrompt }),
        ...state.messages,
      ];
      const response = await llm.invoke(withSystem);
      const planText =
        getMessageContentAsString(response).trim() || "(No plan)";
      const planSteps = parsePlanSteps(planText);
      const planDisplay =
        planSteps.length > 0
          ? planSteps.map((s, i) => `${i + 1}. ${s}`).join("\n")
          : planText;
      return {
        planSteps,
        currentStepIndex: 0,
        messages: [
          new AIMessage({
            content: `[Plan]\n${planDisplay}`,
          }),
        ],
      };
    };

    const llmWithTools = llm.bindTools(tools);

    /** 단순 작업용: 스텝 제약 없이 시스템 프롬프트만으로 도구 사용. */
    const agentDirectNode = async (state: PlanState) => {
      const withSystem = [
        new SystemMessage({ content: systemPrompt }),
        ...state.messages,
      ];
      const response = await llmWithTools.invoke(withSystem);
      return { messages: [response] };
    };

    /** 단계 작업용: 현재 스텝만 실행. */
    const agentNode = async (state: PlanState) => {
      const steps = state.planSteps ?? [];
      const idx = state.currentStepIndex ?? 0;
      const currentStep = steps[idx]?.trim() || "(Complete the task.)";
      const stepSection = `\n\nExecute ONLY this step (step ${idx + 1} of ${
        steps.length || 1
      }): ${currentStep}\nUse tools as needed. When this step is done, reply with a short confirmation and do not call tools.`;
      const withSystem = [
        new SystemMessage({
          content: systemPrompt + stepSection,
        }),
        ...state.messages,
      ];
      console.log(withSystem);
      const response = await llmWithTools.invoke(withSystem);
      return { messages: [response] };
    };

    const stepDoneNode = (state: PlanState) => ({
      currentStepIndex: (state.currentStepIndex ?? 0) + 1,
    });

    const hasToolCalls = (state: PlanState) => {
      const messages = state.messages ?? [];
      const last = messages[messages.length - 1];
      return !!(
        last &&
        "tool_calls" in last &&
        Array.isArray(last.tool_calls) &&
        last.tool_calls.length > 0
      );
    };

    const routeFromRouter = (state: PlanState): "planner" | "agent_direct" =>
      state.isMultiStep ? "planner" : "agent_direct";

    const agentDirectToToolsOrEnd = (state: PlanState): "tools" | typeof END =>
      hasToolCalls(state) ? "tools" : END;

    const agentToToolsOrStepDone = (state: PlanState): "tools" | "step_done" =>
      hasToolCalls(state) ? "tools" : "step_done";

    const routeFromTools = (state: PlanState): "agent" | "agent_direct" =>
      state.isMultiStep ? "agent" : "agent_direct";

    const routeAfterStep = (state: PlanState): "agent" | typeof END => {
      const steps = state.planSteps ?? [];
      const nextIdx = state.currentStepIndex ?? 0;
      return nextIdx < steps.length ? "agent" : END;
    };

    const toolNode = new ToolNode(tools, { handleToolErrors: true });
    const builder = new StateGraph(PlanStateAnnotation)
      .addNode("router", routerNode)
      .addNode("planner", plannerNode)
      .addNode("agent_direct", agentDirectNode)
      .addNode("agent", agentNode)
      .addNode("tools", toolNode)
      .addNode("step_done", stepDoneNode)
      .addEdge(START, "router")
      .addConditionalEdges("router", routeFromRouter, [
        "planner",
        "agent_direct",
      ])
      .addEdge("planner", "agent")
      .addConditionalEdges("agent_direct", agentDirectToToolsOrEnd, [
        "tools",
        END,
      ])
      .addConditionalEdges("tools", routeFromTools, ["agent", "agent_direct"])
      .addConditionalEdges("agent", agentToToolsOrStepDone, [
        "tools",
        "step_done",
      ])
      .addConditionalEdges("step_done", routeAfterStep, ["agent", END]);
    return builder.compile();
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

      const graph = this.buildAgentGraph(llm, tools, systemPrompt);

      const lcMessages = chatMessagesToLangChain(messages);
      const initialState: { messages: BaseMessage[] } = {
        messages: lcMessages,
      };

      let resultMessages: BaseMessage[] = [];
      let planEmitted = false;

      if (onEvent) {
        const stream = await graph.stream(initialState, {
          streamMode: "values",
          recursionLimit: 100,
        });
        let prevLen = 0;
        let lastEmittedContentLength = 0;
        for await (const chunk of stream) {
          const stateChunk = chunk as {
            messages?: BaseMessage[];
            planSteps?: string[];
            currentStepIndex?: number;
          };
          const chunkMessages = stateChunk.messages ?? [];
          // 플랜 이벤트: planner 노드 이후 planSteps 있을 때 한 번만 발송
          if (
            !planEmitted &&
            Array.isArray(stateChunk.planSteps) &&
            stateChunk.planSteps.length > 0
          ) {
            onEvent({
              type: "plan",
              content: stateChunk.planSteps
                .map((s, i) => `${i + 1}. ${s}`)
                .join("\n"),
            });
            planEmitted = true;
          }
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
            lastEmittedContentLength = 0;
          }
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
        const result = (await graph.invoke(initialState, {
          recursionLimit: 100,
        })) as {
          messages?: BaseMessage[];
          planSteps?: string[];
          currentStepIndex?: number;
        };
        resultMessages = result.messages ?? [];
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
