import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getMagicClawHome } from "../common/magicclaw-home.js";
import { AgentChannel } from "../agent/agent.types.js";
import type { BaseMessage } from "langchain";
import type { CreateSessionInput, SessionRecord } from "./session.types.js";
import { deserializeMessages } from "./message-serializer.js";
import { extractSearchableText } from "./message-text.util.js";

type SessionRow = {
  id: string;
  user_id: string;
  channel: string;
  title: string | null;
  created_at: number;
  updated_at: number;
};

type MessageRow = {
  id: number;
  session_id: string;
  role: string;
  content: string;
  search_text: string | null;
  created_at: number;
};

export type MessageHit = {
  session_id: string;
  message_id: number;
  snippet: string;
};

@Injectable()
export class SessionDbService implements OnModuleInit, OnModuleDestroy {
  private db: DatabaseSync | null = null;
  private ftsEnabled = false;

  onModuleInit(): void {
    const dbPath = join(getMagicClawHome(), "sessions.db");
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        title TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id);
    `);
    this.ensureSearchTextColumn();
    this.ftsEnabled = this.probeFts5();
    if (this.ftsEnabled) {
      this.ensureFtsTable();
    }
    this.backfillSearchText();
  }

  isFtsEnabled(): boolean {
    return this.ftsEnabled;
  }

  private probeFts5(): boolean {
    try {
      const db = this.getDb();
      db.exec(
        `CREATE VIRTUAL TABLE IF NOT EXISTS _magicclaw_fts_probe USING fts5(x)`
      );
      db.exec(`DROP TABLE IF EXISTS _magicclaw_fts_probe`);
      return true;
    } catch {
      return false;
    }
  }

  private ensureSearchTextColumn(): void {
    const cols = this.getDb()
      .prepare(`PRAGMA table_info(messages)`)
      .all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === "search_text")) {
      this.getDb().exec(`ALTER TABLE messages ADD COLUMN search_text TEXT`);
    }
  }

  private ensureFtsTable(): void {
    const db = this.getDb();
    const ftsExists = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='messages_fts'`
      )
      .get() as { name?: string } | undefined;

    if (!ftsExists) {
      db.exec(
        `CREATE VIRTUAL TABLE messages_fts USING fts5(search_text, session_id, message_id UNINDEXED)`
      );
      return;
    }

    const ftsInfo = db
      .prepare(`PRAGMA table_info(messages_fts)`)
      .all() as Array<{ name: string }>;
    if (!ftsInfo.some((c) => c.name === "search_text")) {
      db.exec(`DROP TABLE IF EXISTS messages_fts`);
      db.exec(
        `CREATE VIRTUAL TABLE messages_fts USING fts5(search_text, session_id, message_id UNINDEXED)`
      );
    }
  }

  private backfillSearchText(): void {
    const db = this.getDb();
    const rows = db
      .prepare(
        `SELECT id, session_id, role, content, search_text FROM messages WHERE search_text IS NULL OR search_text = ''`
      )
      .all() as Array<{
      id: number;
      session_id: string;
      role: string;
      content: string;
      search_text: string | null;
    }>;

    if (rows.length === 0) return;

    this.runInTransaction(() => {
      const update = db.prepare(
        `UPDATE messages SET search_text = ? WHERE id = ?`
      );
      const ftsDelete = db.prepare(
        `DELETE FROM messages_fts WHERE message_id = ?`
      );
      const ftsInsert = db.prepare(
        `INSERT INTO messages_fts (search_text, session_id, message_id) VALUES (?, ?, ?)`
      );

      for (const row of rows) {
        const searchText = this.deriveSearchText(row.content, row.role);
        update.run(searchText, row.id);
        if (this.ftsEnabled) {
          ftsDelete.run(row.id);
          if (searchText.trim()) {
            ftsInsert.run(searchText, row.session_id, row.id);
          }
        }
      }
    });
  }

  onModuleDestroy(): void {
    this.db?.close();
    this.db = null;
  }

  listSessions(userId: string): SessionRecord[] {
    const rows = this.getDb()
      .prepare(
        `SELECT id, user_id, channel, title, created_at, updated_at
         FROM sessions WHERE user_id = ? ORDER BY updated_at DESC`
      )
      .all(userId) as SessionRow[];

    return rows.map((r) => this.toSessionRecord(r));
  }

  createSession(input: CreateSessionInput, id?: string): SessionRecord {
    const now = Date.now();
    const sessionId = id ?? randomUUID();
    const title = input.title?.trim() || "새 대화";
    this.getDb()
      .prepare(
        `INSERT INTO sessions (id, user_id, channel, title, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(sessionId, input.userId, input.channel, title, now, now);

    return {
      id: sessionId,
      userId: input.userId,
      channel: input.channel,
      title,
      createdAt: now,
      updatedAt: now,
    };
  }

  ensureSession(sessionId: string, input: CreateSessionInput): SessionRecord {
    const existing = this.getSession(sessionId);
    if (existing) return existing;
    return this.createSession(input, sessionId);
  }

  getSession(sessionId: string): SessionRecord | null {
    const row = this.getDb()
      .prepare(
        `SELECT id, user_id, channel, title, created_at, updated_at
         FROM sessions WHERE id = ?`
      )
      .get(sessionId) as SessionRow | undefined;

    if (!row) return null;
    return this.toSessionRecord(row);
  }

  deleteSession(sessionId: string): void {
    const db = this.getDb();
    db.prepare(`DELETE FROM messages WHERE session_id = ?`).run(sessionId);
    if (this.ftsEnabled) {
      db.prepare(`DELETE FROM messages_fts WHERE session_id = ?`).run(
        sessionId
      );
    }
    db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId);
  }

  async loadMessages(sessionId: string): Promise<BaseMessage[]> {
    const rows = this.getDb()
      .prepare(
        `SELECT content, role FROM messages WHERE session_id = ? ORDER BY id ASC`
      )
      .all(sessionId) as Array<{ content: string; role: string }>;
    return deserializeMessages(rows);
  }

  async replaceMessages(
    sessionId: string,
    messages: BaseMessage[]
  ): Promise<void> {
    this.runInTransaction(() => {
      const db = this.getDb();
      db.prepare(`DELETE FROM messages WHERE session_id = ?`).run(sessionId);
      if (this.ftsEnabled) {
        db.prepare(`DELETE FROM messages_fts WHERE session_id = ?`).run(
          sessionId
        );
      }

      const insert = db.prepare(
        `INSERT INTO messages (session_id, role, content, search_text, created_at) VALUES (?, ?, ?, ?, ?)`
      );
      const fts = this.ftsEnabled
        ? db.prepare(
            `INSERT INTO messages_fts (search_text, session_id, message_id) VALUES (?, ?, ?)`
          )
        : null;
      const now = Date.now();

      for (const message of messages) {
        const serialized = JSON.stringify(message.toJSON());
        const searchText = extractSearchableText(message);
        const result = insert.run(
          sessionId,
          message.getType(),
          serialized,
          searchText,
          now
        );
        const messageId = Number(result.lastInsertRowid);
        if (this.ftsEnabled && fts && searchText.trim()) {
          fts.run(searchText, sessionId, messageId);
        }
      }

      db.prepare(`UPDATE sessions SET updated_at = ? WHERE id = ?`).run(
        now,
        sessionId
      );
    });
  }

  async appendMessages(
    sessionId: string,
    messages: BaseMessage[]
  ): Promise<void> {
    if (messages.length === 0) return;

    this.runInTransaction(() => {
      const db = this.getDb();
      const insert = db.prepare(
        `INSERT INTO messages (session_id, role, content, search_text, created_at) VALUES (?, ?, ?, ?, ?)`
      );
      const fts = this.ftsEnabled
        ? db.prepare(
            `INSERT INTO messages_fts (search_text, session_id, message_id) VALUES (?, ?, ?)`
          )
        : null;
      const now = Date.now();

      for (const message of messages) {
        const serialized = JSON.stringify(message.toJSON());
        const searchText = extractSearchableText(message);
        const result = insert.run(
          sessionId,
          message.getType(),
          serialized,
          searchText,
          now
        );
        const messageId = Number(result.lastInsertRowid);
        if (this.ftsEnabled && fts && searchText.trim()) {
          fts.run(searchText, sessionId, messageId);
        }
      }

      db.prepare(`UPDATE sessions SET updated_at = ? WHERE id = ?`).run(
        now,
        sessionId
      );
    });
  }

  searchSessions(userId: string, query: string): SessionRecord[] {
    if (this.ftsEnabled) {
      const rows = this.getDb()
        .prepare(
          `SELECT DISTINCT s.id, s.user_id, s.channel, s.title, s.created_at, s.updated_at
         FROM sessions s
         JOIN messages_fts f ON f.session_id = s.id
         WHERE s.user_id = ? AND messages_fts MATCH ?
         ORDER BY s.updated_at DESC
         LIMIT 20`
        )
        .all(userId, query) as SessionRow[];
      return rows.map((r) => this.toSessionRecord(r));
    }

    const { sql, params } = this.buildLikeSearchClause(userId, query);
    const rows = this.getDb()
      .prepare(
        `SELECT DISTINCT s.id, s.user_id, s.channel, s.title, s.created_at, s.updated_at
         FROM sessions s
         JOIN messages m ON m.session_id = s.id
         WHERE ${sql}
         ORDER BY s.updated_at DESC
         LIMIT 20`
      )
      .all(...params) as SessionRow[];

    return rows.map((r) => this.toSessionRecord(r));
  }

  searchMessageHits(
    userId: string,
    query: string,
    limit: number
  ): MessageHit[] {
    if (this.ftsEnabled) {
      const rows = this.getDb()
        .prepare(
          `SELECT f.session_id, f.message_id,
                snippet(messages_fts, 0, '**', '**', '…', 24) AS snippet
         FROM messages_fts f
         JOIN sessions s ON s.id = f.session_id
         WHERE s.user_id = ? AND messages_fts MATCH ?
         ORDER BY s.updated_at DESC
         LIMIT ?`
        )
        .all(userId, query, limit) as Array<{
        session_id: string;
        message_id: number;
        snippet: string;
      }>;

      return rows.map((r) => ({
        session_id: r.session_id,
        message_id: r.message_id,
        snippet: r.snippet,
      }));
    }

    const { sql, params } = this.buildLikeSearchClause(userId, query);
    const rows = this.getDb()
      .prepare(
        `SELECT m.session_id, m.id AS message_id,
                substr(m.search_text, 1, 120) AS snippet
         FROM messages m
         JOIN sessions s ON s.id = m.session_id
         WHERE ${sql}
         ORDER BY s.updated_at DESC, m.id DESC
         LIMIT ?`
      )
      .all(...params, limit) as Array<{
      session_id: string;
      message_id: number;
      snippet: string;
    }>;

    return rows.map((r) => ({
      session_id: r.session_id,
      message_id: r.message_id,
      snippet: r.snippet?.trim() ? r.snippet : "",
    }));
  }

  private buildLikeSearchClause(
    userId: string,
    query: string
  ): { sql: string; params: Array<string> } {
    const terms = query
      .replace(/["()]/g, " ")
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean);

    if (terms.length === 0) {
      return { sql: "s.user_id = ?", params: [userId] };
    }

    const clauses = [
      "s.user_id = ?",
      ...terms.map(() => "m.search_text LIKE ?"),
    ];
    const params = [userId, ...terms.map((t) => `%${t}%`)];
    return { sql: clauses.join(" AND "), params };
  }

  listMessageRows(sessionId: string): MessageRow[] {
    return this.getDb()
      .prepare(
        `SELECT id, session_id, role, content, search_text, created_at
         FROM messages WHERE session_id = ? ORDER BY id ASC`
      )
      .all(sessionId) as MessageRow[];
  }

  getMessagesAround(
    sessionId: string,
    anchorId: number,
    window: number
  ): {
    messages: MessageRow[];
    beforeCount: number;
    afterCount: number;
  } {
    const db = this.getDb();
    const before = db
      .prepare(
        `SELECT id, session_id, role, content, search_text, created_at
         FROM messages
         WHERE session_id = ? AND id < ?
         ORDER BY id DESC
         LIMIT ?`
      )
      .all(sessionId, anchorId, window) as MessageRow[];

    const anchor = db
      .prepare(
        `SELECT id, session_id, role, content, search_text, created_at
         FROM messages WHERE session_id = ? AND id = ?`
      )
      .get(sessionId, anchorId) as MessageRow | undefined;

    const after = db
      .prepare(
        `SELECT id, session_id, role, content, search_text, created_at
         FROM messages
         WHERE session_id = ? AND id > ?
         ORDER BY id ASC
         LIMIT ?`
      )
      .all(sessionId, anchorId, window) as MessageRow[];

    const messages = [
      ...before.reverse(),
      ...(anchor ? [anchor] : []),
      ...after,
    ];

    return {
      messages,
      beforeCount: before.length,
      afterCount: after.length,
    };
  }

  getConversationBookend(
    sessionId: string,
    end: "start" | "end",
    limit: number
  ): MessageRow[] {
    const order = end === "start" ? "ASC" : "DESC";
    const rows = this.getDb()
      .prepare(
        `SELECT id, session_id, role, content, search_text, created_at
         FROM messages
         WHERE session_id = ? AND role IN ('human', 'user', 'ai', 'assistant')
         ORDER BY id ${order}
         LIMIT ?`
      )
      .all(sessionId, limit) as MessageRow[];

    return end === "start" ? rows : rows.reverse();
  }

  getSessionPreview(sessionId: string, maxChars: number): string {
    const row = this.getDb()
      .prepare(
        `SELECT search_text FROM messages
         WHERE session_id = ? AND search_text IS NOT NULL AND search_text != ''
         ORDER BY id DESC LIMIT 1`
      )
      .get(sessionId) as { search_text: string } | undefined;

    const text = row?.search_text ?? "";
    if (text.length <= maxChars) return text;
    return `${text.slice(0, maxChars)}…`;
  }

  private deriveSearchText(content: string, role: string): string {
    try {
      const parsed = JSON.parse(content) as {
        type?: string;
        kwargs?: { content?: unknown };
        content?: unknown;
      };
      const msgRole = parsed.type ?? role;
      const raw = parsed.kwargs?.content ?? parsed.content;
      if (typeof raw === "string") {
        return raw.trim() ? `${msgRole}: ${raw.trim()}` : "";
      }
      if (Array.isArray(raw)) {
        const text = raw
          .filter(
            (x): x is { type?: string; text?: string } =>
              typeof x === "object" && x !== null
          )
          .filter((x) => x.type === "text" && typeof x.text === "string")
          .map((x) => x.text)
          .join("");
        return text.trim() ? `${msgRole}: ${text.trim()}` : "";
      }
    } catch {
      // fall through
    }
    const trimmed = content.trim();
    return trimmed ? `${role}: ${trimmed}` : "";
  }

  private toSessionRecord(row: SessionRow): SessionRecord {
    return {
      id: row.id,
      userId: row.user_id,
      channel: row.channel as AgentChannel,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private runInTransaction(fn: () => void): void {
    const db = this.getDb();
    db.exec("BEGIN IMMEDIATE");
    try {
      fn();
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  private getDb(): DatabaseSync {
    if (!this.db) throw new Error("Session database not initialized");
    return this.db;
  }
}
