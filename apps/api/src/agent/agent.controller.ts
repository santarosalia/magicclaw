import { Controller, Get } from "@nestjs/common";
import { AgentService } from "./agent.service.js";

@Controller("agent")
export class AgentController {
  constructor(private readonly agent: AgentService) {}

  @Get("tools")
  async listTools(): Promise<{
    tools: { name: string; description?: string }[];
  }> {
    const tools = await this.agent.getMcpToolsList();
    return { tools };
  }
}
