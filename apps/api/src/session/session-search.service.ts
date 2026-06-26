import { Injectable } from "@nestjs/common";
import { SessionDbService } from "./session-db.service.js";
import { shapeMessageForSearch } from "./message-text.util.js";

type ShapedMessage = ReturnType<typeof shapeMessageForSearch>;

@Injectable()
export class SessionSearchService {
  constructor(private readonly sessionDb: SessionDbService) {}

  search(
    userId: string,
    input: {
      query?: string;
      limit?: number;
      sessionId?: string;
      aroundMessageId?: number;
      window?: number;
      currentSessionId?: string;
    }
  ): string {
    const sessionId = input.sessionId?.trim();
    const aroundMessageId = input.aroundMessageId;

    if (sessionId && aroundMessageId != null) {
      return JSON.stringify(
        this.scroll(userId, sessionId, aroundMessageId, input.window ?? 5)
      );
    }

    if (sessionId) {
      return JSON.stringify(this.readSession(userId, sessionId));
    }

    const query = input.query?.trim();
    if (query) {
      return JSON.stringify(
        this.discover(userId, query, input.limit ?? 3, input.currentSessionId)
      );
    }

    return JSON.stringify(this.browse(userId));
  }

  private browse(userId: string) {
    const sessions = this.sessionDb.listSessions(userId).slice(0, 15);
    return {
      mode: "browse",
      sessions: sessions.map((s) => ({
        session_id: s.id,
        title: s.title,
        channel: s.channel,
        updated_at: s.updatedAt,
        preview: this.sessionDb.getSessionPreview(s.id, 120),
      })),
    };
  }

  private discover(
    userId: string,
    query: string,
    limit: number,
    currentSessionId?: string
  ) {
    const capped = Math.min(Math.max(limit, 1), 10);
    const hits = this.sessionDb.searchMessageHits(userId, query, capped * 4);
    const seen = new Set<string>();
    const results: Array<Record<string, unknown>> = [];

    for (const hit of hits) {
      if (hit.session_id === currentSessionId) continue;
      if (seen.has(hit.session_id)) continue;
      seen.add(hit.session_id);

      const session = this.sessionDb.getSession(hit.session_id);
      if (!session || session.userId !== userId) continue;

      const window = this.sessionDb.getMessagesAround(
        hit.session_id,
        hit.message_id,
        5
      );
      const shaped = window.messages.map(shapeMessageForSearch);
      const anchorIdx = shaped.findIndex((m) => m.id === hit.message_id);

      results.push({
        session_id: hit.session_id,
        title: session.title,
        updated_at: session.updatedAt,
        snippet: hit.snippet,
        match_message_id: hit.message_id,
        messages_before: window.beforeCount,
        messages_after: window.afterCount,
        bookend_start: this.sessionDb
          .getConversationBookend(hit.session_id, "start", 3)
          .map(shapeMessageForSearch),
        messages: shaped.map((m, i) =>
          i === anchorIdx ? { ...m, anchor: true } : m
        ),
        bookend_end: this.sessionDb
          .getConversationBookend(hit.session_id, "end", 3)
          .map(shapeMessageForSearch),
      });

      if (results.length >= capped) break;
    }

    return { mode: "discovery", query, results };
  }

  private scroll(
    userId: string,
    sessionId: string,
    aroundMessageId: number,
    window: number
  ) {
    const session = this.sessionDb.getSession(sessionId);
    if (!session || session.userId !== userId) {
      return { success: false, error: "Session not found." };
    }

    const slice = this.sessionDb.getMessagesAround(
      sessionId,
      aroundMessageId,
      window
    );

    return {
      mode: "scroll",
      session_id: sessionId,
      title: session.title,
      around_message_id: aroundMessageId,
      messages_before: slice.beforeCount,
      messages_after: slice.afterCount,
      messages: slice.messages.map((m) => ({
        ...shapeMessageForSearch(m),
        anchor: m.id === aroundMessageId,
      })),
    };
  }

  private readSession(userId: string, sessionId: string) {
    const session = this.sessionDb.getSession(sessionId);
    if (!session || session.userId !== userId) {
      return { success: false, error: "Session not found." };
    }

    const all = this.sessionDb.listMessageRows(sessionId);
    const shaped: ShapedMessage[] = all.map(shapeMessageForSearch);
    const maxDump = 30;

    let messages = shaped;
    let truncated = false;
    if (shaped.length > maxDump) {
      truncated = true;
      const head = shaped.slice(0, 20);
      const tail = shaped.slice(-10);
      messages = [...head, ...tail];
    }

    return {
      mode: "read",
      session_id: sessionId,
      title: session.title,
      message_count: shaped.length,
      truncated,
      messages,
    };
  }
}
