import { Injectable } from "@nestjs/common";
import { TurnPipelineService } from "./turn-pipeline.service.js";
import type { ChatOrchestrator } from "../messenger/chat-orchestrator.port.js";
import { AgentChannel } from "./agent.types";
import type { UserScope } from "../user/user-scope.js";
import { buildUserScope } from "../user/user-scope.js";

@Injectable()
export class AgentChatOrchestratorService implements ChatOrchestrator {
  constructor(private readonly turnPipeline: TurnPipelineService) {}

  async chat(
    sessionId: string,
    text: string,
    channel: AgentChannel,
    userScope?: UserScope
  ): Promise<string> {
    const scope =
      userScope ?? buildUserScope(`legacy:${sessionId}`, sessionId);

    return this.turnPipeline.runTurn({
      sessionId,
      channel,
      userScope: scope,
      userText: text,
    });
  }
}
