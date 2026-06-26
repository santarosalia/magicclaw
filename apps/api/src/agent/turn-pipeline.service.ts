import { Injectable } from "@nestjs/common";
import { AgentService } from "./agent.service.js";
import { TurnContextService } from "./turn-context.service.js";
import { TurnFinalizerService } from "./turn-finalizer.service.js";
import type { AgentEvent } from "./agent.types.js";
import { AgentChannel } from "./agent.types.js";
import type { UserScope } from "../user/user-scope.js";

@Injectable()
export class TurnPipelineService {
  constructor(
    private readonly turnContext: TurnContextService,
    private readonly agent: AgentService,
    private readonly turnFinalizer: TurnFinalizerService
  ) {}

  async runTurn(input: {
    sessionId: string;
    channel: AgentChannel;
    userScope: UserScope;
    userText: string;
    onEvent?: (event: AgentEvent) => void;
  }): Promise<string> {
    const ctx = await this.turnContext.build(input);
    const runResult = await this.agent.chat(
      {
        messagesLc: ctx.messagesLc,
        sessionId: ctx.sessionId,
        channel: ctx.channel,
        userScope: ctx.userScope,
        memoryContext: ctx.memoryContext,
        systemMemoryBlock: ctx.systemMemoryBlock,
        contextFilesBlock: ctx.contextFilesBlock,
        skillsIndexBlock: ctx.skillsIndexBlock,
      },
      input.onEvent
    );

    const finalized = await this.turnFinalizer.finalize(ctx, {
      messages: runResult.messages,
      turnExitReason: runResult.turnExitReason,
      apiCallCount: runResult.apiCallCount,
    });

    return finalized.content;
  }
}
