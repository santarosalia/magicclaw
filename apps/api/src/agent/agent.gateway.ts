import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from "@nestjs/websockets";
import { Logger } from "@nestjs/common";
import type { Socket } from "socket.io";
import { WebSocketServer } from "@nestjs/websockets";
import { AgentChannel, type AgentEvent } from "./agent.types";
import { SessionDbService } from "../session/session-db.service.js";
import { UserScopeResolver } from "../user/user-scope.resolver.js";
import { buildUserScope } from "../user/user-scope.js";
import { TurnPipelineService } from "./turn-pipeline.service.js";

@WebSocketGateway({
  namespace: "/agent",
  cors: {
    origin: process.env.AGENT_WS_CORS_ORIGIN ?? process.env.WEB_ORIGIN ?? "*",
  },
})
export class AgentGateway {
  private readonly logger = new Logger(AgentGateway.name);
  @WebSocketServer()
  server!: import("socket.io").Server;

  constructor(
    private readonly turnPipeline: TurnPipelineService,
    private readonly sessionDb: SessionDbService,
    private readonly userScopeResolver: UserScopeResolver
  ) {}

  @SubscribeMessage("chat")
  async handleChat(
    @MessageBody()
    body: {
      userMessage: string;
      model?: string;
      userId?: string;
      conversationId?: string;
    },
    @ConnectedSocket() client: Socket
  ) {
    const userMessage = body.userMessage ?? "";
    if (!userMessage.trim()) return;

    let userScope;
    try {
      userScope = this.userScopeResolver.resolve(AgentChannel.WEB, {
        userId: body.userId,
        conversationId: body.conversationId,
      });
    } catch {
      client.emit("agent_error", { message: "userId가 필요합니다." });
      return;
    }

    let sessionId = body.conversationId?.trim();
    if (!sessionId) {
      const created = this.sessionDb.createSession({
        userId: userScope.userId,
        channel: AgentChannel.WEB,
      });
      sessionId = created.id;
      client.emit("session_created", { sessionId });
    } else {
      this.sessionDb.ensureSession(sessionId, {
        userId: userScope.userId,
        channel: AgentChannel.WEB,
      });
    }

    const onEvent = (event: AgentEvent) => {
      client.emit("agent_event", { ...event, sessionId });
    };

    try {
      await this.turnPipeline.runTurn({
        sessionId,
        channel: AgentChannel.WEB,
        userScope: buildUserScope(userScope.userId, sessionId),
        userText: userMessage.trim(),
        onEvent,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`chat handling failed: ${message}`);
      if (error instanceof Error && error.stack) {
        this.logger.debug(error.stack);
      }
      client.emit("agent_error", {
        sessionId,
        message: message || "에이전트 처리 중 오류가 발생했습니다.",
      });
    }
  }
}
