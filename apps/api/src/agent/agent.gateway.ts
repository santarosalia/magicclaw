import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import { WebSocketServer } from "@nestjs/websockets";
import { AgentService, type AgentEvent, type ChatMessage } from "./agent.service.js";

@WebSocketGateway({
  namespace: "/agent",
  cors: {
    origin: "*",
  },
})
export class AgentGateway {
  @WebSocketServer()
  server!: Server;

  constructor(private readonly agent: AgentService) {}

  @SubscribeMessage("chat")
  async handleChat(
    @MessageBody()
    body: {
      messages?: ChatMessage[];
      model?: string;
    },
    @ConnectedSocket() client: Socket
  ) {
    const messages = body.messages ?? [];

    const onEvent = (event: AgentEvent) => {
      client.emit("agent_event", event);
    };

    await this.agent.chat(
      {
        messages,
        model: body.model,
      },
      onEvent
    );
  }
}

