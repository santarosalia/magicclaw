export const CHAT_ORCHESTRATOR = Symbol("CHAT_ORCHESTRATOR");

export interface ChatOrchestrator {
  chat(sessionId: string, text: string): Promise<string>;
}
