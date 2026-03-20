import { Injectable } from "@nestjs/common";
import type { BaseMessage } from "langchain";

@Injectable()
export class SessionService {
  /** 세션별 메시지 히스토리 (sessionId -> LangChain BaseMessage[]) */
  private readonly sessions = new Map<string, BaseMessage[]>();

  get(sessionId: string): BaseMessage[] {
    return this.sessions.get(sessionId) ?? [];
  }

  set(sessionId: string, messages: BaseMessage[]): void {
    this.sessions.set(sessionId, messages);
  }

  append(sessionId: string, ...messages: BaseMessage[]): void {
    const current = this.get(sessionId);
    this.sessions.set(sessionId, [...current, ...messages]);
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }
}
