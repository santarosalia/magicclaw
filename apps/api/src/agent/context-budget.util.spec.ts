import { AIMessage, HumanMessage, ToolMessage } from "langchain";
import { getMessageContentAsString } from "./agent.types.js";
import {
  computeMessageTokenBudget,
  estimateMessagesTokens,
  getContextBudgetConfig,
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
      new ToolMessage({
        content: "x".repeat(20_000),
        tool_call_id: "call_1",
      }),
      new HumanMessage({ content: "latest question" }),
    ];
    const budget = estimateMessagesTokens([messages[1]]) + 100;
    const shrunk = shrinkMessagesToBudget(messages, budget);
    expect(shrunk).toHaveLength(2);
    expect(getMessageContentAsString(shrunk[0])).toContain("truncated");
    expect(estimateMessagesTokens(shrunk)).toBeLessThanOrEqual(budget);
  });

  it("reserves output, tools, and safety margin from context window", () => {
    const config = getContextBudgetConfig();
    const budget = computeMessageTokenBudget(config, ["system prompt"]);
    expect(budget).toBeLessThan(config.contextWindow);
    expect(budget).toBeGreaterThan(0);
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
