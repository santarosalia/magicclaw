import { Injectable } from "@nestjs/common";
import type { BaseMessage } from "langchain";
import { SessionDbService } from "./session-db.service.js";

@Injectable()
export class SessionService {
  private readonly cache = new Map<string, BaseMessage[]>();

  constructor(private readonly sessionDb: SessionDbService) {}

  get(sessionId: string): BaseMessage[] {
    return this.cache.get(sessionId) ?? [];
  }

  async ensureLoaded(sessionId: string): Promise<BaseMessage[]> {
    if (this.cache.has(sessionId)) return this.get(sessionId);
    const messages = await this.sessionDb.loadMessages(sessionId);
    this.cache.set(sessionId, messages);
    return messages;
  }

  set(sessionId: string, messages: BaseMessage[]): void {
    this.cache.set(sessionId, messages);
    void this.sessionDb.replaceMessages(sessionId, messages);
  }

  append(sessionId: string, ...messages: BaseMessage[]): void {
    const current = this.get(sessionId);
    const next = [...current, ...messages];
    this.cache.set(sessionId, next);
    void this.sessionDb.appendMessages(sessionId, messages);
  }

  async appendAsync(sessionId: string, ...messages: BaseMessage[]): Promise<void> {
    const current = this.get(sessionId);
    const next = [...current, ...messages];
    this.cache.set(sessionId, next);
    await this.sessionDb.appendMessages(sessionId, messages);
  }

  delete(sessionId: string): void {
    this.cache.delete(sessionId);
  }

  has(sessionId: string): boolean {
    return this.cache.has(sessionId);
  }
}
