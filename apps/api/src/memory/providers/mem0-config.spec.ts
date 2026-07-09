import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildMem0OssMemoryConfig,
  defaultMem0OssConfig,
  isMem0Available,
  resolveMem0Mode,
  validateMem0OssConfig,
} from "./mem0-config.js";

describe("mem0-config", () => {
  let prevHome: string | undefined;

  beforeEach(() => {
    prevHome = process.env.MAGICCLAW_HOME;
    process.env.MAGICCLAW_HOME = mkdtempSync(join(tmpdir(), "magicclaw-mem0-"));
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.MAGICCLAW_HOME;
    else process.env.MAGICCLAW_HOME = prevHome;
    delete process.env.MEM0_MODE;
    delete process.env.MEM0_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  it("defaults to platform mode", () => {
    expect(resolveMem0Mode({ mode: "platform" })).toBe("platform");
    expect(resolveMem0Mode({ mode: "oss" })).toBe("oss");
  });

  it("prefers MEM0_MODE env override", () => {
    process.env.MEM0_MODE = "oss";
    expect(resolveMem0Mode({ mode: "platform" })).toBe("oss");
  });

  it("validates oss config requires openai keys when using openai providers", () => {
    const oss = defaultMem0OssConfig();
    const errors = validateMem0OssConfig(oss);
    expect(errors).toContain(
      "OSS OpenAI LLM에는 OPENAI_API_KEY(또는 apiKeyEnv)가 필요합니다."
    );
  });

  it("marks platform mem0 available when MEM0_API_KEY is set", () => {
    process.env.MEM0_API_KEY = "m0-test";
    expect(isMem0Available({ mode: "platform" })).toBe(true);
  });

  it("builds oss memory config with resolved api keys and qdrant default path", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const oss = defaultMem0OssConfig();
    oss.vectorStore = {
      provider: "qdrant",
      config: { collectionName: "magicclaw_memories" },
    };

    const built = buildMem0OssMemoryConfig(oss);
    expect(built.llm.config.apiKey).toBe("sk-test");
    expect(built.embedder.config.apiKey).toBe("sk-test");
    expect(built.vectorStore.config.path).toContain("mem0_qdrant");
    expect(built.historyDbPath).toContain("mem0-history.db");
  });

  it("expands tilde-based mem0 paths before building config", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const oss = defaultMem0OssConfig();
    oss.historyDbPath = "~/.magicclaw/mem0-history.db";
    oss.vectorStore = {
      provider: "qdrant",
      config: {
        collectionName: "magicclaw_memories",
        path: "~/.magicclaw/mem0_qdrant",
      },
    };

    const built = buildMem0OssMemoryConfig(oss);
    expect(built.historyDbPath).not.toContain("~");
    expect(String(built.vectorStore.config.path)).not.toContain("~");
  });
});
