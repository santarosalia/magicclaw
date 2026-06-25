import { Logger } from "@nestjs/common";
import type {
  MemoryInitContext,
  MemoryProvider,
  SyncTurnInput,
} from "../memory-provider.interface.js";
import {
  buildMem0OssMemoryConfig,
  defaultMem0OssConfig,
  isMem0Available,
  resolveMem0ApiKey,
  resolveMem0Mode,
  type Mem0ProviderConfig,
} from "./mem0-config.js";

type Mem0Message = { role: "user" | "assistant"; content: string };

type Mem0PlatformClient = {
  add: (messages: Mem0Message[], options?: Record<string, unknown>) => Promise<unknown>;
  search: (
    query: string,
    options?: Record<string, unknown>
  ) => Promise<{ results?: Array<{ memory?: string }> } | Array<{ memory?: string }>>;
};

type Mem0OssMemory = {
  add: (
    messages: Mem0Message[] | string,
    options: Record<string, unknown>
  ) => Promise<{ results?: Array<{ memory?: string }> }>;
  search: (
    query: string,
    options?: Record<string, unknown>
  ) => Promise<{ results?: Array<{ memory?: string }> }>;
  close?: () => Promise<void>;
};

interface Mem0Backend {
  add(
    messages: Mem0Message[],
    opts: { userId: string; runId: string; agentId: string }
  ): Promise<void>;
  search(query: string, opts: { userId: string; topK: number }): Promise<string[]>;
  shutdown(): Promise<void>;
}

class PlatformMem0Backend implements Mem0Backend {
  constructor(
    private readonly client: Mem0PlatformClient,
    private readonly rerank: boolean
  ) {}

  async add(
    messages: Mem0Message[],
    opts: { userId: string; runId: string; agentId: string }
  ): Promise<void> {
    await this.client.add(messages, {
      user_id: opts.userId,
      run_id: opts.runId,
      agent_id: opts.agentId,
    });
  }

  async search(
    query: string,
    opts: { userId: string; topK: number }
  ): Promise<string[]> {
    const response = await this.client.search(query, {
      filters: { user_id: opts.userId },
      topK: opts.topK,
      rerank: this.rerank,
    });
    return unwrapMemories(response);
  }

  async shutdown(): Promise<void> {
    // Platform client has no explicit close.
  }
}

class OssMem0Backend implements Mem0Backend {
  constructor(private readonly memory: Mem0OssMemory) {}

  async add(
    messages: Mem0Message[],
    opts: { userId: string; runId: string; agentId: string }
  ): Promise<void> {
    await this.memory.add(messages, {
      userId: opts.userId,
      runId: opts.runId,
      agentId: opts.agentId,
    });
  }

  async search(
    query: string,
    opts: { userId: string; topK: number }
  ): Promise<string[]> {
    const response = await this.memory.search(query, {
      topK: opts.topK,
      filters: { user_id: opts.userId },
    });
    return unwrapMemories(response);
  }

  async shutdown(): Promise<void> {
    if (typeof this.memory.close === "function") {
      await this.memory.close().catch(() => undefined);
    }
  }
}

function unwrapMemories(
  response:
    | { results?: Array<{ memory?: string }> }
    | Array<{ memory?: string }>
    | undefined
): string[] {
  const results = Array.isArray(response) ? response : response?.results ?? [];
  return results.map((r) => r.memory ?? "").filter(Boolean);
}

export class Mem0MemoryProvider implements MemoryProvider {
  readonly name = "mem0";
  private readonly logger = new Logger(Mem0MemoryProvider.name);
  private readonly mem0Config: Mem0ProviderConfig;
  private backend: Mem0Backend | null = null;
  private agentId = "magicclaw";
  private userId = "";
  private sessionId = "";
  private cachedPrefetch = "";

  constructor(mem0Config?: Mem0ProviderConfig) {
    this.mem0Config = mem0Config ?? {};
  }

  isAvailable(): boolean {
    return isMem0Available(this.mem0Config);
  }

  async initialize(ctx: MemoryInitContext): Promise<void> {
    this.userId = ctx.userId;
    this.sessionId = ctx.sessionId;
    this.agentId = this.mem0Config.agentId?.trim() || "magicclaw";

    if (!this.isAvailable()) return;

    if (this.backend) {
      await this.backend.shutdown().catch(() => undefined);
      this.backend = null;
    }

    try {
      const mode = resolveMem0Mode(this.mem0Config);
      if (mode === "oss") {
        const { Memory } = await import("mem0ai/oss");
        const ossStored = this.mem0Config.oss ?? defaultMem0OssConfig();
        const memory = new Memory(buildMem0OssMemoryConfig(ossStored));
        this.backend = new OssMem0Backend(memory as unknown as Mem0OssMemory);
      } else {
        const { MemoryClient } = await import("mem0ai");
        const client = new MemoryClient({
          apiKey: resolveMem0ApiKey(this.mem0Config),
        });
        this.backend = new PlatformMem0Backend(
          client as unknown as Mem0PlatformClient,
          this.mem0Config.rerank !== false
        );
      }
    } catch (error) {
      this.logger.warn(
        `Failed to init mem0 (${resolveMem0Mode(this.mem0Config)}): ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      this.backend = null;
    }
  }

  systemPromptBlock(): string {
    const mode = resolveMem0Mode(this.mem0Config);
    const label = mode === "oss" ? "Mem0 (self-hosted)" : "Mem0";
    return (
      `Long-term semantic memory is available via ${label}. ` +
      "Recalled context may appear in <memory-context> blocks each turn."
    );
  }

  async prefetch(query: string, _sessionId: string): Promise<string> {
    if (this.cachedPrefetch) {
      const cached = this.cachedPrefetch;
      this.cachedPrefetch = "";
      return cached;
    }
    return this.searchMemories(query);
  }

  queuePrefetch(query: string, _sessionId: string): void {
    void this.searchMemories(query).then((result) => {
      this.cachedPrefetch = result;
    });
  }

  syncTurn(input: SyncTurnInput): void {
    if (
      !this.backend ||
      !input.userContent.trim() ||
      !input.assistantContent.trim()
    ) {
      return;
    }

    void this.backend
      .add(
        [
          { role: "user", content: input.userContent },
          { role: "assistant", content: input.assistantContent },
        ],
        {
          userId: input.userId,
          runId: input.sessionId,
          agentId: this.agentId,
        }
      )
      .catch((error: unknown) => {
        this.logger.warn(
          `mem0 add failed: ${error instanceof Error ? error.message : String(error)}`
        );
      });
  }

  async shutdown(): Promise<void> {
    if (this.backend) {
      await this.backend.shutdown().catch(() => undefined);
      this.backend = null;
    }
    this.cachedPrefetch = "";
  }

  async onPreCompress(sessionId: string): Promise<void> {
    this.logger.debug(`mem0 onPreCompress for session ${sessionId}`);
  }

  onMemoryWrite(target: "memory" | "user", content: string): void {
    if (!this.backend) return;
    void this.backend
      .add([{ role: "user", content: `[${target}] ${content}` }], {
        userId: this.userId,
        runId: this.sessionId,
        agentId: this.agentId,
      })
      .catch(() => undefined);
  }

  private async searchMemories(query: string): Promise<string> {
    if (!this.backend) return "";
    try {
      const lines = await this.backend.search(query, {
        userId: this.userId,
        topK: 5,
      });
      return lines.length > 0 ? lines.join("\n") : "";
    } catch (error) {
      this.logger.warn(
        `mem0 search failed: ${error instanceof Error ? error.message : String(error)}`
      );
      return "";
    }
  }
}
