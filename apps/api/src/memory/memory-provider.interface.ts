import type { BaseMessage } from "langchain";

export interface MemoryInitContext {
  userId: string;
  sessionId: string;
  channel: string;
}

export interface SyncTurnInput {
  userContent: string;
  assistantContent: string;
  sessionId: string;
  userId: string;
  messages?: BaseMessage[];
}

export interface MemoryProvider {
  readonly name: string;
  isAvailable(): boolean;
  initialize(ctx: MemoryInitContext): Promise<void>;
  systemPromptBlock(): string;
  prefetch(query: string, sessionId: string): Promise<string>;
  queuePrefetch(query: string, sessionId: string): void;
  syncTurn(input: SyncTurnInput): void;
  shutdown(): Promise<void>;
  onMemoryWrite?(target: "memory" | "user", content: string): void;
  onPreCompress?(sessionId: string): Promise<void>;
}
