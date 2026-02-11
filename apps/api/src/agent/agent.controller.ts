import { Body, Controller, Get, Post } from "@nestjs/common";
import type { AgentChatOptions, ChatMessage } from "./agent.service.js";
import { AgentService } from "./agent.service.js";

@Controller("agent")
export class AgentController {
  constructor(private readonly agent: AgentService) {}

  @Get("tools")
  async listTools(): Promise<{
    tools: { name: string; description?: string }[];
  }> {
    const openaiTools = await this.agent.getMcpToolsAsOpenAI();
    const tools = openaiTools
      .filter(
        (
          t
        ): t is {
          type: "function";
          function: { name: string; description?: string };
        } => t.type === "function"
      )
      .map((t) => ({
        name: t.function.name,
        description: t.function.description,
      }));
    return { tools };
  }

  @Post("chat")
  async chat(
    @Body()
    body: {
      messages?: ChatMessage[];
      model?: string;
      maxToolRounds?: number;
    }
  ) {
    const messages = body.messages ?? [];
    const result = await this.agent.chat(
      {
        messages,
        model: body.model,
        maxToolRounds: body.maxToolRounds,
      },
      // HTTP 요청에서는 이벤트 스트리밍을 사용하지 않으므로 콜백은 전달하지 않는다.
    );
    return result;
  }
}
