import { AIMessage, HumanMessage, ToolMessage } from "langchain";
import {
  deserializeMessage,
  serializeMessage,
} from "./message-serializer.js";

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

    expect(aiRound.getType()).toBe("ai");
    expect(aiRound).toBeInstanceOf(AIMessage);
    expect((aiRound as AIMessage).tool_calls?.[0]?.name).toBe("memory");

    expect(toolRound.getType()).toBe("tool");
    expect(toolRound).toBeInstanceOf(ToolMessage);
    expect((toolRound as ToolMessage).tool_call_id).toBe("call_1");
    expect((toolRound as ToolMessage).name).toBe("memory");
  });

  it("preserves human messages", async () => {
    const human = new HumanMessage({ content: "hello" });
    const round = await deserializeMessage(await serializeMessage(human));
    expect(round.getType()).toBe("human");
    expect(round.content).toBe("hello");
  });
});
