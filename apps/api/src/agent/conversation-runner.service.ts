import { Injectable } from "@nestjs/common";
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
  BaseMessage,
  HumanMessage,
  ToolCall,
  AIMessageChunk,
} from "langchain";
import type { ChatOpenAI } from "@langchain/openai";
import {
  getMessageContentAsString,
  type AgentEvent,
  type AgentChatOptions,
  AgentChannel,
} from "./agent.types";
import { IterationBudget } from "./iteration-budget.js";
import {
  computeMessageTokenBudget,
  estimateToolsTokens,
  getContextBudgetConfig,
  isContextLengthError,
  shrinkMessagesToBudget,
} from "./context-budget.util.js";
import { MEMORY_GUIDANCE } from "../memory/memory-guidance.js";
import { SKILLS_GUIDANCE } from "../skills/skills-guidance.js";

const AgentStateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  sessionId: Annotation<string>(),
  channel: Annotation<AgentChannel>(),
  memoryContext: Annotation<string>(),
  systemMemoryBlock: Annotation<string>(),
  contextFilesBlock: Annotation<string>(),
  skillsIndexBlock: Annotation<string>(),
  apiCallCount: Annotation<number>({
    reducer: (_, next) => next,
    default: () => 0,
  }),
  nudgeCount: Annotation<number>({
    reducer: (_, next) => next,
    default: () => 0,
  }),
  turnExitReason: Annotation<string>({
    reducer: (_, next) => next,
    default: () => "",
  }),
});

type AgentState = typeof AgentStateAnnotation.State;

export interface ConversationRunResult {
  messages: BaseMessage[];
  turnExitReason: string;
  apiCallCount: number;
}

@Injectable()
export class ConversationRunnerService {
  private readonly maxIterations = Number(
    process.env.AGENT_MAX_ITERATIONS ?? 90
  );
  private readonly recursionLimit = Number(
    process.env.AGENT_RECURSION_LIMIT ?? 100
  );
  private readonly baseSystemPrompt =
    process.env.AGENT_SYSTEM_PROMPT ??
    `You are a helpful assistant named MagicClaw.
You have access to tools (via MCP) to perform actions when necessary.
Always reason about the user's intent and choose whether tools are actually needed.
Reply in the same language as the user when appropriate.
For multi-step tasks, use the todo tool to track progress before executing tools.
On every new conversation, read USER PROFILE and AGENT MEMORY sections in your instructions and <memory-context> blocks — they are authoritative across sessions.
Use session_search to recall prior conversations when the user asks about past work.
Before tasks that match an installed skill, use skill_manage(action="read") to load the playbook.
If a browser tab is already open and the user asks to search,
prefer interacting with the current browser page instead of using the generic search tool.

${MEMORY_GUIDANCE}

${SKILLS_GUIDANCE}`;

  private buildSystemPrompt(
    memoryBlock?: string,
    contextFilesBlock?: string,
    skillsIndexBlock?: string
  ): string {
    const parts = [
      this.baseSystemPrompt,
      contextFilesBlock?.trim(),
      skillsIndexBlock?.trim(),
      memoryBlock?.trim(),
    ].filter(Boolean);
    return parts.join("\n\n");
  }

  private async invokeWithContextGuard(
    llm: { invoke: ChatOpenAI["invoke"] },
    systemPrompt: string,
    messages: BaseMessage[],
    toolsTokenEstimate = 0
  ) {
    const config = getContextBudgetConfig();
    for (let attempt = 0; attempt < 6; attempt++) {
      const shrink = 1 - attempt * 0.12;
      const budget = Math.floor(
        computeMessageTokenBudget(
          {
            ...config,
            safetyMargin: config.safetyMargin + attempt * 1024,
          },
          [systemPrompt],
          toolsTokenEstimate
        ) * shrink
      );
      const fitted = shrinkMessagesToBudget(messages, budget);
      try {
        return await llm.invoke([
          new SystemMessage({ content: systemPrompt }),
          ...fitted,
        ]);
      } catch (error) {
        if (!isContextLengthError(error) || attempt === 5) throw error;
      }
    }
    throw new Error("context guard exhausted retries");
  }

  private injectEphemeralContext(
    messages: BaseMessage[],
    memoryContext?: string
  ): BaseMessage[] {
    if (!memoryContext?.trim()) return messages;
    const lastIdx = messages.length - 1;
    const last = messages[lastIdx];
    if (!(last instanceof HumanMessage)) return messages;

    const base =
      typeof last.content === "string"
        ? last.content
        : getMessageContentAsString(last);
    return [
      ...messages.slice(0, lastIdx),
      new HumanMessage({ content: `${base}\n\n${memoryContext}` }),
    ];
  }

  private lastAssistant(state: AgentState): AIMessage | AIMessageChunk | null {
    for (let i = state.messages.length - 1; i >= 0; i--) {
      const msg = state.messages[i];
      if (msg instanceof AIMessage || msg instanceof AIMessageChunk) {
        return msg;
      }
    }
    return null;
  }

  private hasToolCalls(state: AgentState): boolean {
    const last = this.lastAssistant(state);
    return Boolean(last?.tool_calls?.length);
  }

  private isEmptyAssistantResponse(state: AgentState): boolean {
    const last = this.lastAssistant(state);
    if (!last) return true;
    if (this.hasToolCalls(state)) return false;
    return !getMessageContentAsString(last).trim();
  }

  private buildGraph(
    llm: ChatOpenAI,
    tools: StructuredToolInterface[],
    budget: IterationBudget,
    options: AgentChatOptions
  ) {
    const llmWithTools = llm.bindTools(tools);
    const toolsTokenEstimate = estimateToolsTokens(tools);
    const toolNode = new ToolNode(tools, { handleToolErrors: true });

    const runTools = async (state: AgentState) => {
      const result = await toolNode.invoke(state);
      const toolMessages =
        (result as { messages?: BaseMessage[] }).messages ?? [];
      const memoryTouched = toolMessages.some(
        (message) => message instanceof ToolMessage && message.name === "memory"
      );
      if (memoryTouched && options.refreshMemoryBlocks) {
        const refreshed = options.refreshMemoryBlocks();
        return {
          ...result,
          systemMemoryBlock: refreshed.systemMemoryBlock,
          memoryContext: refreshed.memoryContext,
        };
      }
      return result;
    };

    const callModel = async (state: AgentState) => {
      if (!budget.consume()) {
        return {
          turnExitReason: "budget_exhausted",
          apiCallCount: budget.totalUsed,
        };
      }

      const systemPrompt = this.buildSystemPrompt(
        state.systemMemoryBlock,
        state.contextFilesBlock,
        state.skillsIndexBlock
      );
      const apiMessages = this.injectEphemeralContext(
        state.messages,
        state.memoryContext
      );
      const response = await this.invokeWithContextGuard(
        llmWithTools,
        systemPrompt,
        apiMessages,
        toolsTokenEstimate
      );

      return {
        messages: [response],
        apiCallCount: budget.totalUsed,
        turnExitReason: "",
      };
    };

    const nudge = async (state: AgentState) => ({
      messages: [
        new HumanMessage({
          content:
            "Please provide a complete response to the user. If you need tools, call them. Otherwise reply with your final answer.",
        }),
      ],
      nudgeCount: (state.nudgeCount ?? 0) + 1,
    });

    const summarize = async (state: AgentState) => {
      const systemPrompt =
        "Summarize progress and give the best possible final answer. Tool budget is exhausted.";
      const response = await this.invokeWithContextGuard(
        llm,
        systemPrompt,
        state.messages,
        toolsTokenEstimate
      );
      return {
        messages: [response],
        turnExitReason: state.turnExitReason || "budget_exhausted",
        apiCallCount: budget.totalUsed,
      };
    };

    const routeAfterModel = (state: AgentState): string => {
      if (
        state.turnExitReason === "budget_exhausted" &&
        !this.hasToolCalls(state)
      ) {
        return "summarize";
      }
      if (this.hasToolCalls(state)) return "tools";
      if (this.isEmptyAssistantResponse(state) && (state.nudgeCount ?? 0) < 1) {
        return "nudge";
      }
      return END;
    };

    const routeAfterTools = (state: AgentState): string => {
      if (budget.exhausted) return "summarize";
      return "callModel";
    };

    return new StateGraph(AgentStateAnnotation)
      .addNode("callModel", callModel)
      .addNode("tools", runTools)
      .addNode("nudge", nudge)
      .addNode("summarize", summarize)
      .addEdge(START, "callModel")
      .addConditionalEdges("callModel", routeAfterModel, [
        "tools",
        "nudge",
        "summarize",
        END,
      ])
      .addConditionalEdges("tools", routeAfterTools, ["callModel", "summarize"])
      .addEdge("nudge", "callModel")
      .addEdge("summarize", END)
      .compile();
  }

  async run(
    llm: ChatOpenAI,
    tools: StructuredToolInterface[],
    options: AgentChatOptions,
    onEvent?: (event: AgentEvent) => void
  ): Promise<ConversationRunResult> {
    const budget = new IterationBudget(this.maxIterations);
    const graph = this.buildGraph(llm, tools, budget, options);

    const stream = await graph.stream(
      {
        messages: options.messagesLc,
        sessionId: options.sessionId,
        channel: options.channel,
        memoryContext: options.memoryContext ?? "",
        systemMemoryBlock: options.systemMemoryBlock ?? "",
        contextFilesBlock: options.contextFilesBlock ?? "",
        skillsIndexBlock: options.skillsIndexBlock ?? "",
      },
      {
        streamMode: ["updates", "messages", "values"],
        recursionLimit: this.recursionLimit,
      }
    );

    let resultMessages: BaseMessage[] = [];
    let turnExitReason = "completed";
    let apiCallCount = 0;
    /** 현재 callModel/summarize 라운드에서 messages 스트림으로 보낸 글자 수 */
    let roundStreamedChars = 0;

    const emitAssistantOrIntermediate = (messages: BaseMessage[]) => {
      for (const message of messages) {
        if (
          !(message instanceof AIMessage || message instanceof AIMessageChunk)
        ) {
          continue;
        }
        const text = getMessageContentAsString(message).trim();
        if (!text) continue;
        if (message.tool_calls?.length) {
          onEvent?.({ type: "intermediate_message", content: text });
        } else {
          onEvent?.({ type: "assistant_message", content: text });
        }
      }
    };

    const emitToolCalls = (messages: BaseMessage[]) => {
      for (const message of messages) {
        if (
          !(message instanceof AIMessage || message instanceof AIMessageChunk)
        ) {
          continue;
        }
        for (const toolCall of message.tool_calls ?? []) {
          onEvent?.({ type: "tool_call", toolCall: toolCall as ToolCall });
        }
      }
    };

    const hasToolCallsIn = (messages: BaseMessage[]) =>
      messages.some(
        (message) =>
          (message instanceof AIMessage || message instanceof AIMessageChunk) &&
          Boolean(message.tool_calls?.length)
      );

    for await (const [kind, data] of stream) {
      if (kind === "values") {
        resultMessages = data.messages;
        if (data.turnExitReason) turnExitReason = data.turnExitReason;
        apiCallCount = data.apiCallCount ?? apiCallCount;
        continue;
      }
      if (kind === "updates") {
        if (data.callModel?.messages) {
          const modelMessages = data.callModel.messages as BaseMessage[];
          // 토큰 스트림이 없었을 때만 완성 메시지로 보완 (중복 방지)
          if (roundStreamedChars === 0) {
            emitAssistantOrIntermediate(modelMessages);
          } else if (hasToolCallsIn(modelMessages)) {
            // 스트림된 텍스트는 프론트가 tool_call 시 intermediate 로 회수
          }
          emitToolCalls(modelMessages);
          roundStreamedChars = 0;
        }
        if (data.summarize?.messages) {
          if (roundStreamedChars === 0) {
            emitAssistantOrIntermediate(
              data.summarize.messages as BaseMessage[]
            );
          }
          roundStreamedChars = 0;
        }
        if (data.tools) {
          for (const message of data.tools.messages as ToolMessage[]) {
            onEvent?.({ type: "tool_message", toolMessage: message });
          }
        }
        if (data.callModel?.turnExitReason) {
          turnExitReason = data.callModel.turnExitReason;
        }
        continue;
      }
      if (kind === "messages") {
        const [token, metadata] = data;
        if (
          (metadata.langgraph_node === "callModel" ||
            metadata.langgraph_node === "summarize") &&
          token instanceof AIMessageChunk &&
          token.content
        ) {
          const text =
            typeof token.content === "string"
              ? token.content
              : getMessageContentAsString(token);
          if (!text) continue;
          roundStreamedChars += text.length;
          onEvent?.({ type: "assistant_message", content: text });
        }
      }
    }

    if (turnExitReason === "budget_exhausted" && budget.exhausted) {
      turnExitReason = "budget_exhausted";
    } else if (!turnExitReason) {
      turnExitReason = "completed";
    }

    if (resultMessages.length > 0) {
      const lastFinalAssistant = [...resultMessages]
        .reverse()
        .find(
          (message) =>
            (message instanceof AIMessage ||
              message instanceof AIMessageChunk) &&
            !message.tool_calls?.length
        );
      const last =
        lastFinalAssistant ?? resultMessages[resultMessages.length - 1];
      onEvent?.({
        type: "final_message",
        message: getMessageContentAsString(last).trim(),
      });
    }

    return {
      messages: resultMessages,
      turnExitReason,
      apiCallCount: budget.totalUsed,
    };
  }
}
