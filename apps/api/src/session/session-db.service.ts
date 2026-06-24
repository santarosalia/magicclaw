import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getMagicClawHome } from "../common/magicclaw-home.js";
import { AgentChannel } from "../agent/agent.types.js";
import type { BaseMessage } from "langchain";
import type { CreateSessionInput, SessionRecord } from "./session.types.js";
import { deserializeMessages } from "./message-serializer.js";

type SessionRow = {
  id: string;
  user_id: string;
  channel: string;
  title: string | null;
  created_at: number;
  updated_at: number;
};

@Injectable()
export class SessionDbService implements OnModuleInit, OnModuleDestroy {
  private db: DatabaseSync | null = null;

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
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(content, session_id);
    `);
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
    db.prepare(`DELETE FROM messages_fts WHERE session_id = ?`).run(sessionId);
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

  async replaceMessages(sessionId: string, messages: BaseMessage[]): Promise<void> {
    this.runInTransaction(() => {
      const db = this.getDb();
      db.prepare(`DELETE FROM messages WHERE session_id = ?`).run(sessionId);
      db.prepare(`DELETE FROM messages_fts WHERE session_id = ?`).run(sessionId);

      const insert = db.prepare(
        `INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)`
      );
      const fts = db.prepare(
        `INSERT INTO messages_fts (content, session_id) VALUES (?, ?)`
      );
      const now = Date.now();

      for (const message of messages) {
        const serialized = JSON.stringify(message.toJSON());
        insert.run(sessionId, message.getType(), serialized, now);
        fts.run(serialized, sessionId);
      }

      db.prepare(`UPDATE sessions SET updated_at = ? WHERE id = ?`).run(
        now,
        sessionId
      );
    });
  }

  async appendMessages(sessionId: string, messages: BaseMessage[]): Promise<void> {
    if (messages.length === 0) return;

    this.runInTransaction(() => {
      const db = this.getDb();
      const insert = db.prepare(
        `INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)`
      );
      const fts = db.prepare(
        `INSERT INTO messages_fts (content, session_id) VALUES (?, ?)`
      );
      const now = Date.now();

      for (const message of messages) {
        const serialized = JSON.stringify(message.toJSON());
        insert.run(sessionId, message.getType(), serialized, now);
        fts.run(serialized, sessionId);
      }

      db.prepare(`UPDATE sessions SET updated_at = ? WHERE id = ?`).run(
        now,
        sessionId
      );
    });
  }

  searchSessions(userId: string, query: string): SessionRecord[] {
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
