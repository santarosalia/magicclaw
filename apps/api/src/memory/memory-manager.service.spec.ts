import { Test } from "@nestjs/testing";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryManagerService } from "./memory-manager.service.js";
import { MemoryConfigStoreService } from "../store/memory-config-store.service.js";

describe("MemoryManagerService", () => {
  let service: MemoryManagerService;
  let home: string;
  let prevHome: string | undefined;

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), "magicclaw-mem-mgr-"));
    prevHome = process.env.MAGICCLAW_HOME;
    process.env.MAGICCLAW_HOME = home;

    const moduleRef = await Test.createTestingModule({
      providers: [MemoryManagerService, MemoryConfigStoreService],
    }).compile();

    service = moduleRef.get(MemoryManagerService);
  });

  afterEach(async () => {
    await service.shutdownAll();
    if (prevHome === undefined) delete process.env.MAGICCLAW_HOME;
    else process.env.MAGICCLAW_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  });

  it("loads persisted user profile into system prompt on new session", async () => {
    const userId = "web:test-user";
    await service.initializeAll(userId, "session-a");
    const tool = service.createMemoryToolForUser(userId);
    const writeResult = await tool.invoke({
      action: "add",
      target: "user",
      content: "User's name is Bob.",
    });
    expect(JSON.parse(writeResult as string).success).toBe(true);

    await service.initializeAll(userId, "session-b");
    expect(service.buildSystemPromptBlock(userId)).toContain("Bob");
    expect(service.buildBuiltinTurnContext(userId)).toContain("Bob");
  });
});
