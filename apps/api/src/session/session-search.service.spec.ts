import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HumanMessage, AIMessage } from "langchain";
import { AgentChannel } from "../agent/agent.types.js";
import { SessionDbService } from "./session-db.service.js";
import { SessionSearchService } from "./session-search.service.js";

describe("SessionSearchService", () => {
  let home: string;
  let prevHome: string | undefined;
  let db: SessionDbService;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "magicclaw-sess-"));
    prevHome = process.env.MAGICCLAW_HOME;
    process.env.MAGICCLAW_HOME = home;
    db = new SessionDbService();
    db.onModuleInit();
  });

  afterEach(() => {
    db.onModuleDestroy();
    if (prevHome === undefined) delete process.env.MAGICCLAW_HOME;
    else process.env.MAGICCLAW_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  });

  it("discovers prior sessions by searchable text", async () => {
    const userId = "user-a";
    const current = db.createSession({ userId, channel: AgentChannel.WEB, title: "current" });
    const past = db.createSession({ userId, channel: AgentChannel.WEB, title: "auth refactor" });

    await db.replaceMessages(past.id, [
      new HumanMessage({ content: "Let's refactor the auth middleware." }),
      new AIMessage({ content: "We should split JWT validation into a guard." }),
    ]);
    await db.replaceMessages(current.id, [
      new HumanMessage({ content: "hello" }),
    ]);

    const search = new SessionSearchService(db);
    const raw = search.search(userId, {
      query: "auth middleware",
      currentSessionId: current.id,
    });
    const parsed = JSON.parse(raw) as {
      mode: string;
      results: Array<{ session_id: string; title: string }>;
    };

    expect(parsed.mode).toBe("discovery");
    expect(parsed.results.some((r) => r.session_id === past.id)).toBe(true);
    expect(parsed.results.some((r) => r.session_id === current.id)).toBe(false);
  });

  it("browses recent sessions", () => {
    const userId = "user-a";
    db.createSession({ userId, channel: AgentChannel.WEB, title: "one" });
    db.createSession({ userId, channel: AgentChannel.WEB, title: "two" });

    const search = new SessionSearchService(db);
    const parsed = JSON.parse(search.search(userId, {})) as {
      mode: string;
      sessions: Array<{ title: string }>;
    };

    expect(parsed.mode).toBe("browse");
    expect(parsed.sessions.length).toBeGreaterThanOrEqual(2);
  });
});
