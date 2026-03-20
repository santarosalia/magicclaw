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
  ToolCall,
  AIMessageChunk,
} from "langchain";
import type { ChatOpenAI } from "@langchain/openai";
import {
  parsePlanSteps,
  getMessageContentAsString,
  type AgentEvent,
  AgentChannel,
} from "./agent.types";

const PlanStateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  isMultiStep: Annotation<boolean>(),
  planSteps: Annotation<string[]>(),
  currentStepIndex: Annotation<number>(),
  sessionId: Annotation<string>(),
  channel: Annotation<AgentChannel>(),
});

type PlanState = typeof PlanStateAnnotation.State;

@Injectable()
export class ConversationRunnerService {
  private readonly recursionLimit = Number(
    process.env.AGENT_RECURSION_LIMIT ?? 100
  );
  private readonly systemPrompt =
    process.env.AGENT_SYSTEM_PROMPT ??
    `You are a helpful assistant named MagicClaw.
You have access to tools (via MCP) to perform actions when necessary.
Always reason about the user's intent and choose whether tools are actually needed.
Reply in the same language as the user when appropriate.

when you are executing a step, consider the previous conversation context to determine which tool to use.
If a browser tab is already open and the user asks to search,
prefer interacting with the current browser page instead of using the generic search tool.`;

  private buildAgentGraph(llm: ChatOpenAI, tools: StructuredToolInterface[]) {
    const llmWithTools = llm.bindTools(tools);
    const routerPrompt = `You are a task classifier. Based on the user's latest message, decide if the task is:
SIMPLE: one or two quick actions. Reply with exactly: SIMPLE
MULTI_STEP: requires several ordered steps. Reply with exactly: MULTI_STEP
Reply with only one word: SIMPLE or MULTI_STEP.`;
    const planPrompt = `You are a planning assistant. Based on the conversation, create a brief step-by-step plan to fulfill the user's request. Use the same language as the user. Output one step per line, each line starting with "1. ", "2. ", etc. If the request is simple, output a single step. Output ONLY the plan, no other text or tools.`;

    const routerNode = async (state: PlanState) => {
      const response = await llm.invoke([
        new SystemMessage({ content: routerPrompt }),
        ...state.messages,
      ]);
      const text = getMessageContentAsString(response).trim().toUpperCase();
      const isMultiStep =
        text.includes("MULTI") ||
        text === "MULTI_STEP" ||
        text.startsWith("MULTI");
      return { isMultiStep };
    };

    const plannerNode = async (state: PlanState) => {
      const response = await llmWithTools.invoke(
        [new SystemMessage({ content: planPrompt }), ...state.messages],
        { tool_choice: "none" }
      );
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
        messages: [new AIMessage({ content: `[Plan]\n${planDisplay}` })],
      };
    };

    const agentDirectNode = async (state: PlanState) => {
      const response = await llmWithTools.invoke([
        new SystemMessage({ content: this.systemPrompt }),
        ...state.messages,
      ]);
      return { messages: [response] };
    };

    const agentNode = async (state: PlanState) => {
      const steps = state.planSteps ?? [];
      const idx = state.currentStepIndex ?? 0;
      const currentStep = steps[idx]?.trim() || "(Complete the task.)";
      const response = await llmWithTools.invoke([
        new SystemMessage({ content: this.systemPrompt }),
        new SystemMessage({
          content: `Execute ONLY this step (step ${idx + 1} of ${
            steps.length || 1
          }): ${currentStep}\nUse tools as needed. When this step is done, reply with a short confirmation and do not call tools.
          Your session ID is ${state.sessionId}.`,
        }),
        ...state.messages,
      ]);
      return { messages: [response] };
    };

    const stepDoneNode = (state: PlanState) => ({
      currentStepIndex: (state.currentStepIndex ?? 0) + 1,
    });
    const hasToolCalls = (state: PlanState) => {
      const last = (state.messages ?? []).at(-1);
      return Boolean(last instanceof AIMessageChunk && last.tool_calls?.length);
    };

    return new StateGraph(PlanStateAnnotation)
      .addNode("router", routerNode)
      .addNode("planner", plannerNode)
      .addNode("agent_direct", agentDirectNode)
      .addNode("agent", agentNode)
      .addNode("tools", new ToolNode(tools, { handleToolErrors: true }))
      .addNode("step_done", stepDoneNode)
      .addEdge(START, "router")
      .addConditionalEdges(
        "router",
        (s) => (s.isMultiStep ? "planner" : "agent_direct"),
        ["planner", "agent_direct"]
      )
      .addEdge("planner", "agent")
      .addConditionalEdges(
        "agent_direct",
        (s) => (hasToolCalls(s) ? "tools" : END),
        ["tools", END]
      )
      .addConditionalEdges(
        "tools",
        (s) => (s.isMultiStep ? "agent" : "agent_direct"),
        ["agent", "agent_direct"]
      )
      .addConditionalEdges(
        "agent",
        (s) => (hasToolCalls(s) ? "tools" : "step_done"),
        ["tools", "step_done"]
      )
      .addConditionalEdges(
        "step_done",
        (s) =>
          (s.currentStepIndex ?? 0) < (s.planSteps?.length ?? 0)
            ? "agent"
            : END,
        ["agent", END]
      )
      .compile();
  }

  async run(
    llm: ChatOpenAI,
    tools: StructuredToolInterface[],
    options: {
      messagesLc: BaseMessage[];
      sessionId: string;
      channel: AgentChannel;
    },
    onEvent?: (event: AgentEvent) => void
  ): Promise<BaseMessage[]> {
    const graph = this.buildAgentGraph(llm, tools);
    const stream = await graph.stream(
      {
        messages: options.messagesLc,
        sessionId: options.sessionId,
        channel: options.channel,
      },
      {
        streamMode: ["updates", "messages", "values"],
        recursionLimit: this.recursionLimit,
      }
    );

    let resultMessages: BaseMessage[] = [];
    const onToolCall = (messages: BaseMessage[]) => {
      for (const message of messages) {
        if (message instanceof AIMessageChunk && message.tool_calls) {
          for (const toolCall of message.tool_calls) {
            onEvent?.({ type: "tool_call", toolCall: toolCall as ToolCall });
          }
        }
      }
    };

    for await (const [kind, data] of stream) {
      if (kind === "values") {
        resultMessages = data.messages;
        continue;
      }
      if (kind === "updates") {
        if (data.agent) onToolCall(data.agent.messages);
        if (data.agent_direct) onToolCall(data.agent_direct.messages);
        if (data.tools) {
          for (const message of data.tools.messages as ToolMessage[]) {
            onEvent?.({ type: "tool_message", toolMessage: message });
          }
        }
        continue;
      }
      if (kind === "messages") {
        const [token, metadata] = data;
        if (
          (metadata.langgraph_node === "planner" ||
            metadata.langgraph_node === "agent" ||
            metadata.langgraph_node === "agent_direct") &&
          token instanceof AIMessageChunk &&
          token.content
        ) {
          onEvent?.({ type: "assistant_message", content: token.content });
        }
      }
    }

    if (resultMessages.length > 0) {
      const last = resultMessages[resultMessages.length - 1];
      onEvent?.({
        type: "final_message",
        message: getMessageContentAsString(last).trim(),
      });
    }
    return resultMessages;
  }
}
