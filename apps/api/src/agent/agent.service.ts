import { Injectable } from "@nestjs/common";
import type { BaseMessage } from "langchain";
import { ConversationRunnerService } from "./conversation-runner.service.js";
import { ModelFactoryService } from "./model-factory.service.js";
import { ToolingGatewayService } from "./tooling-gateway.service.js";
import type { AgentChatOptions, AgentEvent } from "./agent.types.js";

@Injectable()
export class AgentService {
  constructor(
    private readonly modelFactory: ModelFactoryService,
    private readonly toolingGateway: ToolingGatewayService,
    private readonly conversationRunner: ConversationRunnerService
  ) {}

  /** 등록된 MCP 서버에서 도구 목록만 반환 (API 목록용). */
  async getMcpToolsList(): Promise<{ name: string; description?: string }[]> {
    return this.toolingGateway.listTools();
  }

  async chat(
    options: AgentChatOptions,
    onEvent?: (event: AgentEvent) => void
  ): Promise<BaseMessage[]> {
    const llm = this.modelFactory.create(this.modelFactory.getDefaultModel());
    const { tools, close } = await this.toolingGateway.getLangChainTools();
    try {
      return this.conversationRunner.run(llm, tools, options, onEvent);
    } finally {
      await close();
    }
  }
}
