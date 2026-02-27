import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  OnGatewayDisconnect,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import { WebSocketServer } from "@nestjs/websockets";
import { HumanMessage } from "langchain";
import { AgentService, type AgentEvent } from "./agent.service.js";
import { SessionService } from "./session.service.js";

@WebSocketGateway({
  namespace: "/agent",
  cors: {
    origin: "*",
  },
})
export class AgentGateway implements OnGatewayDisconnect {
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

    const messagesLcResult = await this.agent.chat(
      {
        messagesLc,
      },
      onEvent
    );

    const newMessages = messagesLcResult.slice(messagesLc.length);
    this.session.append(client.id, ...newMessages);
    onEvent({
      type: "final_message",
    });
  }
}
