import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AIMessage, HumanMessage, ToolMessage } from "langchain";
import {
  deserializeMessage,
  serializeMessage,
} from "../dist/session/message-serializer.js";

describe("message-serializer tool round-trip", () => {
  it("preserves tool_calls and tool messages", async () => {
    const ai = new AIMessage({
      content: "",
      tool_calls: [
        {
          id: "call_1",
          name: "memory",
          args: { action: "add", content: "test" },
        },
      ],
    });
    const tool = new ToolMessage({
      content: '{"success":true}',
      tool_call_id: "call_1",
      name: "memory",
    });

    const aiRound = await deserializeMessage(await serializeMessage(ai));
    const toolRound = await deserializeMessage(await serializeMessage(tool));

    assert.equal(aiRound.getType(), "ai");
    assert.equal(aiRound.tool_calls?.[0]?.name, "memory");

    assert.equal(toolRound.getType(), "tool");
    assert.equal(toolRound.tool_call_id, "call_1");
    assert.equal(toolRound.name, "memory");
  });

  it("preserves human messages", async () => {
    const human = new HumanMessage({ content: "hello" });
    const round = await deserializeMessage(await serializeMessage(human));
    assert.equal(round.getType(), "human");
    assert.equal(round.content, "hello");
  });
});
