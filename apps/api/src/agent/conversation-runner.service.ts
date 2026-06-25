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

const AgentStateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  sessionId: Annotation<string>(),
  channel: Annotation<AgentChannel>(),
  memoryContext: Annotation<string>(),
  systemMemoryBlock: Annotation<string>(),
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
When the user shares their name, preferences, or other profile facts, persist them with the memory tool (target "user") before replying.
On every new conversation, read USER PROFILE and AGENT MEMORY sections in your instructions and <memory-context> blocks — they are authoritative across sessions.
If a browser tab is already open and the user asks to search,
prefer interacting with the current browser page instead of using the generic search tool.`;

  private buildSystemPrompt(memoryBlock?: string): string {
    if (!memoryBlock?.trim()) return this.baseSystemPrompt;
    return `${this.baseSystemPrompt}\n\n${memoryBlock}`;
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
    const toolNode = new ToolNode(tools, { handleToolErrors: true });

    const runTools = async (state: AgentState) => {
      const result = await toolNode.invoke(state);
      const toolMessages = (result as { messages?: BaseMessage[] }).messages ?? [];
      const memoryTouched = toolMessages.some(
        (message) =>
          message instanceof ToolMessage && message.name === "memory"
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

      const apiMessages = this.injectEphemeralContext(
        state.messages,
        state.memoryContext
      );
      const response = await llmWithTools.invoke([
        new SystemMessage({
          content: this.buildSystemPrompt(state.systemMemoryBlock),
        }),
        ...apiMessages,
      ]);

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
      const response = await llm.invoke([
        new SystemMessage({
          content:
            "Summarize progress and give the best possible final answer. Tool budget is exhausted.",
        }),
        ...state.messages,
      ]);
      return {
        messages: [response],
        turnExitReason: state.turnExitReason || "budget_exhausted",
        apiCallCount: budget.totalUsed,
      };
    };

    const routeAfterModel = (state: AgentState): string => {
      if (state.turnExitReason === "budget_exhausted" && !this.hasToolCalls(state)) {
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
      },
      {
        streamMode: ["updates", "messages", "values"],
        recursionLimit: this.recursionLimit,
      }
    );

    let resultMessages: BaseMessage[] = [];
    let turnExitReason = "completed";
    let apiCallCount = 0;

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

    for await (const [kind, data] of stream) {
      if (kind === "values") {
        resultMessages = data.messages;
        if (data.turnExitReason) turnExitReason = data.turnExitReason;
        apiCallCount = data.apiCallCount ?? apiCallCount;
        continue;
      }
      if (kind === "updates") {
        if (data.callModel?.messages) {
          emitToolCalls(data.callModel.messages);
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
          onEvent?.({ type: "assistant_message", content: token.content });
        }
      }
    }

    if (turnExitReason === "budget_exhausted" && budget.exhausted) {
      turnExitReason = "budget_exhausted";
    } else if (!turnExitReason) {
      turnExitReason = "completed";
    }

    if (resultMessages.length > 0) {
      const last = resultMessages[resultMessages.length - 1];
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
