import { Injectable } from "@nestjs/common";
import type { BaseMessage } from "langchain";

@Injectable()
export class SessionService {
  /** 웹소켓 세션별 메시지 히스토리 (socket.id → LangChain BaseMessage[]) */
  private readonly sessions = new Map<string, BaseMessage[]>();

  get(socketId: string): BaseMessage[] {
    return this.sessions.get(socketId) ?? [];
  }

  set(socketId: string, messages: BaseMessage[]): void {
    this.sessions.set(socketId, messages);
  }

  append(socketId: string, ...messages: BaseMessage[]): void {
    const current = this.get(socketId);
    this.sessions.set(socketId, [...current, ...messages]);
  }

  delete(socketId: string): void {
    this.sessions.delete(socketId);
  }

  has(socketId: string): boolean {
    return this.sessions.has(socketId);
  }
}
