import { Injectable } from "@nestjs/common";
import { HumanMessage } from "langchain";
import { AgentService } from "./agent.service.js";
import { SessionService } from "../session/session.service.js";
import type { ChatOrchestrator } from "../messenger/chat-orchestrator.port.js";

@Injectable()
export class AgentChatOrchestratorService implements ChatOrchestrator {
  constructor(
    private readonly agentService: AgentService,
    private readonly session: SessionService
  ) {}

  async chat(sessionId: string, text: string): Promise<string> {
    const history = this.session.get(sessionId);
    const userMsg = new HumanMessage({ content: text });
    const messagesLc = [...history, userMsg];
    const messagesLcResult = await this.agentService.chat({
      messagesLc,
      sessionId,
    });
    const last = messagesLcResult.at(-1);
    const content = typeof last?.content === "string" ? last.content : "";
    const newMessages = messagesLcResult.slice(messagesLc.length - 1);
    this.session.append(sessionId, ...newMessages);
    return content || "응답을 생성하지 못했습니다.";
  }
}
