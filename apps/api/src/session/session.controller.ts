import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { SessionDbService } from "./session-db.service.js";
import { SessionService } from "./session.service.js";
import { AgentChannel, getMessageContentAsString } from "../agent/agent.types.js";

@Controller("sessions")
export class SessionController {
  constructor(
    private readonly sessionDb: SessionDbService,
    private readonly sessionService: SessionService
  ) {}

  @Get()
  list(@Query("userId") userId: string, @Query("q") q?: string) {
    if (!userId?.trim()) return [];
    if (q?.trim()) return this.sessionDb.searchSessions(userId, q.trim());
    return this.sessionDb.listSessions(userId);
  }

  @Post()
  create(
    @Body()
    body: { userId: string; channel?: AgentChannel; title?: string }
  ) {
    return this.sessionDb.createSession({
      userId: body.userId,
      channel: body.channel ?? AgentChannel.WEB,
      title: body.title,
    });
  }

  @Get(":id/messages")
  async getMessages(@Param("id") id: string) {
    const session = this.sessionDb.getSession(id);
    if (!session) throw new NotFoundException("Session not found");
    const messages = await this.sessionDb.loadMessages(id);
    this.sessionService.set(id, messages);
    return {
      session,
      messages: messages.map((m) => ({
        role: m.getType(),
        content: getMessageContentAsString(m),
        data: m.toJSON(),
      })),
    };
  }

  @Delete(":id")
  delete(@Param("id") id: string) {
    this.sessionDb.deleteSession(id);
    this.sessionService.delete(id);
    return { ok: true };
  }
}
