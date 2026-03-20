import { AgentChannel } from "../agent/agent.types";

export const CHAT_ORCHESTRATOR = Symbol("CHAT_ORCHESTRATOR");

export interface ChatOrchestrator {
  chat(sessionId: string, text: string, channel: AgentChannel): Promise<string>;
}
