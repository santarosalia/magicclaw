import { Injectable } from "@nestjs/common";
import type { BaseMessage } from "langchain";
import { SessionService } from "../session/session.service.js";
import { MemoryManagerService } from "../memory/memory-manager.service.js";
import { CuratorService } from "../skills/curator.service.js";
import { getMessageContentAsString } from "./agent.types.js";
import type { TurnContext } from "./turn-context.service.js";

export interface TurnResult {
  content: string;
  messages: BaseMessage[];
  turnExitReason: string;
  apiCallCount: number;
}

@Injectable()
export class TurnFinalizerService {
  constructor(
    private readonly session: SessionService,
    private readonly memoryManager: MemoryManagerService,
    private readonly curator: CuratorService
  ) {}

  async finalize(
    ctx: TurnContext,
    result: {
      messages: BaseMessage[];
      turnExitReason: string;
      apiCallCount: number;
    }
  ): Promise<TurnResult> {
    const newMessages = result.messages.slice(ctx.priorMessageCount);
    if (newMessages.length > 0) {
      await this.session.appendAsync(ctx.sessionId, ...newMessages);
    }

    const last = result.messages.at(-1);
    const content = last ? getMessageContentAsString(last).trim() : "";

    this.memoryManager.syncBuiltinFromTurn({
      userContent: ctx.userText,
      assistantContent: content,
      sessionId: ctx.sessionId,
      userId: ctx.userScope.userId,
      messages: result.messages,
    });

    this.memoryManager.syncAll({
      userContent: ctx.userText,
      assistantContent: content,
      sessionId: ctx.sessionId,
      userId: ctx.userScope.userId,
      messages: result.messages,
    });
    this.memoryManager.queuePrefetchAll(ctx.userText, ctx.sessionId);

    this.curator.recordTurnFinished();
    void this.curator.maybeRunCurator();

    return {
      content: content || "응답을 생성하지 못했습니다.",
      messages: result.messages,
      turnExitReason: result.turnExitReason,
      apiCallCount: result.apiCallCount,
    };
  }
}
