import { AIMessage, HumanMessage, ToolMessage } from "langchain";
import { getMessageContentAsString } from "./agent.types.js";
import {
  computeMessageTokenBudget,
  estimateMessagesTokens,
  getContextBudgetConfig,
  repairToolCallPairs,
  shrinkMessagesToBudget,
  trimMessagesToTokenBudget,
} from "./context-budget.util.js";

describe("context-budget.util", () => {
  it("trims oldest messages when over budget", () => {
    const messages = [
      new HumanMessage({ content: "a".repeat(3000) }),
      new AIMessage({ content: "b".repeat(3000) }),
      new HumanMessage({ content: "keep me" }),
    ];
    const budget = estimateMessagesTokens([messages[2]]) + 50;
    const trimmed = trimMessagesToTokenBudget(messages, budget);
    expect(trimmed).toHaveLength(1);
    expect(trimmed[0].content).toBe("keep me");
  });

  it("drops assistant tool-call groups atomically", () => {
    const messages = [
      new AIMessage({
        content: "",
        tool_calls: [{ id: "call_1", name: "search", args: { q: "x" } }],
      }),
      new ToolMessage({
        content: "old tool output ".repeat(200),
        tool_call_id: "call_1",
      }),
      new HumanMessage({ content: "latest question" }),
    ];
    const budget = estimateMessagesTokens([messages[2]]) + 50;
    const trimmed = trimMessagesToTokenBudget(messages, budget);
    expect(trimmed).toHaveLength(1);
    expect(trimmed[0].content).toBe("latest question");
  });

  it("truncates oversized tool output when dropping is not enough", () => {
    const messages = [
      new AIMessage({
        content: "",
        tool_calls: [{ id: "call_1", name: "search", args: {} }],
      }),
      new ToolMessage({
        content: "x".repeat(20_000),
        tool_call_id: "call_1",
      }),
      new HumanMessage({ content: "latest question" }),
    ];
    const budget = estimateMessagesTokens([messages[2]]) + 200;
    const shrunk = shrinkMessagesToBudget(messages, budget);
    expect(shrunk.length).toBeGreaterThanOrEqual(1);
    expect(getMessageContentAsString(shrunk[shrunk.length - 1])).toBe(
      "latest question"
    );
    const tool = shrunk.find((m) => m instanceof ToolMessage);
    if (tool) {
      expect(getMessageContentAsString(tool)).toContain("truncated");
    }
    expect(estimateMessagesTokens(shrunk)).toBeLessThanOrEqual(budget);
  });

  it("reserves output, tools, and safety margin from context window", () => {
    const config = getContextBudgetConfig();
    const budget = computeMessageTokenBudget(config, ["system prompt"]);
    expect(budget).toBeLessThan(config.contextWindow);
    expect(budget).toBeGreaterThan(0);
  });

  it("repairs missing tool outputs so OpenAI does not 400", () => {
    const messages = [
      new HumanMessage({ content: "do it" }),
      new AIMessage({
        content: "",
        tool_calls: [
          { id: "call_3jVt60n8WxAjje4y3YoIJB7Y", name: "search", args: { q: "x" } },
        ],
      }),
      // ToolMessage intentionally missing (e.g. after broken compression)
      new HumanMessage({ content: "follow up" }),
    ];
    const repaired = repairToolCallPairs(messages);
    expect(repaired).toHaveLength(4);
    expect(repaired[2]).toBeInstanceOf(ToolMessage);
    expect((repaired[2] as ToolMessage).tool_call_id).toBe(
      "call_3jVt60n8WxAjje4y3YoIJB7Y"
    );
    expect(getMessageContentAsString(repaired[2])).toContain("unavailable");
  });

  it("drops orphan tool messages without a matching tool call", () => {
    const messages = [
      new ToolMessage({
        content: "orphan",
        tool_call_id: "call_missing",
      }),
      new HumanMessage({ content: "hi" }),
    ];
    const repaired = repairToolCallPairs(messages);
    expect(repaired).toHaveLength(1);
    expect(repaired[0].content).toBe("hi");
  });

  it("strips Responses raw output so unpaired function_calls are not replayed", () => {
    const ai = new AIMessage({
      content: "",
      tool_calls: [{ id: "call_live", name: "search", args: { q: "x" } }],
      response_metadata: {
        output: [
          {
            type: "function_call",
            call_id: "call_live",
            name: "search",
            arguments: '{"q":"x"}',
          },
        ],
      },
    });
    const repaired = repairToolCallPairs([
      ai,
      new HumanMessage({ content: "next" }),
    ]);
    const repairedAi = repaired[0] as AIMessage;
    expect(repairedAi.response_metadata?.output).toBeUndefined();
    expect(repaired.filter((m) => m instanceof ToolMessage)).toHaveLength(1);
  });

  it("shrinkMessagesToBudget always repairs broken tool pairs even under budget", () => {
    const messages = [
      new AIMessage({
        content: "",
        tool_calls: [{ id: "call_x", name: "memory", args: {} }],
      }),
      new HumanMessage({ content: "next" }),
    ];
    const budget = estimateMessagesTokens(messages) + 500;
    const shrunk = shrinkMessagesToBudget(messages, budget);
    const toolMsgs = shrunk.filter((m) => m instanceof ToolMessage);
    expect(toolMsgs).toHaveLength(1);
    expect((toolMsgs[0] as ToolMessage).tool_call_id).toBe("call_x");
  });

  describe("getContextBudgetConfig priority", () => {
    const prev = process.env.AGENT_CONTEXT_WINDOW;

    afterEach(() => {
      if (prev === undefined) delete process.env.AGENT_CONTEXT_WINDOW;
      else process.env.AGENT_CONTEXT_WINDOW = prev;
    });

    it("uses AGENT_CONTEXT_WINDOW env over config value", () => {
      process.env.AGENT_CONTEXT_WINDOW = "99999";
      const config = getContextBudgetConfig({ contextWindow: 32000 });
      expect(config.contextWindow).toBe(99999);
    });

    it("uses active config contextWindow when env is unset", () => {
      delete process.env.AGENT_CONTEXT_WINDOW;
      const config = getContextBudgetConfig({ contextWindow: 32000 });
      expect(config.contextWindow).toBe(32000);
    });

    it("falls back to 65536 when env and config are unset", () => {
      delete process.env.AGENT_CONTEXT_WINDOW;
      const config = getContextBudgetConfig();
      expect(config.contextWindow).toBe(65536);
    });
  });
});
