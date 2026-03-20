import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  OnGatewayDisconnect,
} from "@nestjs/websockets";
import { Logger } from "@nestjs/common";
import type { Server, Socket } from "socket.io";
import { WebSocketServer } from "@nestjs/websockets";
import { HumanMessage } from "langchain";
import { AgentService } from "./agent.service.js";
import { AgentChannel, AgentEvent } from "./agent.types";
import { SessionService } from "../session/session.service.js";

@WebSocketGateway({
  namespace: "/agent",
  cors: {
    origin: process.env.AGENT_WS_CORS_ORIGIN ?? process.env.WEB_ORIGIN ?? "*",
  },
})
export class AgentGateway implements OnGatewayDisconnect {
  private readonly logger = new Logger(AgentGateway.name);
  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly agent: AgentService,
    private readonly session: SessionService
  ) {}

  handleDisconnect(client: Socket): void {
    this.session.delete(client.id);
  }

  @SubscribeMessage("chat")
  async handleChat(
    @MessageBody()
    body: {
      userMessage: string;
      model?: string;
    },
    @ConnectedSocket() client: Socket
  ) {
    const userMessage = body.userMessage ?? "";
    if (!userMessage.trim()) return;

    const history = this.session.get(client.id);
    const userMsg = new HumanMessage({ content: userMessage.trim() });
    const messagesLc = [...history, userMsg];

    const onEvent = (event: AgentEvent) => {
      client.emit("agent_event", event);
    };

    try {
      const messagesLcResult = await this.agent.chat(
        {
          messagesLc,
          sessionId: client.id,
          channel: AgentChannel.WEB,
        },
        onEvent
      );
      const newMessages = messagesLcResult.slice(messagesLc.length - 1);
      this.session.append(client.id, ...newMessages);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`chat handling failed: ${message}`);
      client.emit("agent_error", {
        message: "에이전트 처리 중 오류가 발생했습니다.",
      });
    }
  }
}
