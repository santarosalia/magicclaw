import { AgentChannel } from "../agent/agent.types";
import type { UserScope } from "../user/user-scope";

export const CHAT_ORCHESTRATOR = Symbol("CHAT_ORCHESTRATOR");

export interface ChatOrchestrator {
  chat(
    sessionId: string,
    text: string,
    channel: AgentChannel,
    userScope?: UserScope
  ): Promise<string>;
}
