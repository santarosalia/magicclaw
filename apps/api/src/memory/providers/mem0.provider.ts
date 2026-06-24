import { Logger } from "@nestjs/common";
import type {
  MemoryInitContext,
  MemoryProvider,
  SyncTurnInput,
} from "../memory-provider.interface.js";

type Mem0Module = typeof import("mem0ai");
type MemoryClientInstance = InstanceType<Mem0Module["MemoryClient"]>;

export class Mem0MemoryProvider implements MemoryProvider {
  readonly name = "mem0";
  private readonly logger = new Logger(Mem0MemoryProvider.name);
  private client: MemoryClientInstance | null = null;
  private userId = "";
  private sessionId = "";
  private cachedPrefetch = "";

  isAvailable(): boolean {
    return Boolean(process.env.MEM0_API_KEY?.trim());
  }

  async initialize(ctx: MemoryInitContext): Promise<void> {
    this.userId = ctx.userId;
    this.sessionId = ctx.sessionId;
    if (!this.isAvailable()) return;

    try {
      const { MemoryClient } = await import("mem0ai");
      this.client = new MemoryClient({
        apiKey: process.env.MEM0_API_KEY ?? "",
      });
    } catch (error) {
      this.logger.warn(
        `Failed to init mem0 client: ${error instanceof Error ? error.message : String(error)}`
      );
      this.client = null;
    }
  }

  systemPromptBlock(): string {
    return (
      "Long-term semantic memory is available via Mem0. " +
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
    if (!this.client || !input.userContent.trim() || !input.assistantContent.trim()) {
      return;
    }

    void this.client
      .add(
        [
          { role: "user", content: input.userContent },
          { role: "assistant", content: input.assistantContent },
        ],
        { user_id: input.userId, run_id: input.sessionId }
      )
      .catch((error: unknown) => {
        this.logger.warn(
          `mem0 add failed: ${error instanceof Error ? error.message : String(error)}`
        );
      });
  }

  async shutdown(): Promise<void> {
    this.client = null;
    this.cachedPrefetch = "";
  }

  async onPreCompress(sessionId: string): Promise<void> {
    this.logger.debug(`mem0 onPreCompress for session ${sessionId}`);
  }

  onMemoryWrite(target: "memory" | "user", content: string): void {
    if (!this.client) return;
    void this.client
      .add([{ role: "user", content: `[${target}] ${content}` }], {
        user_id: this.userId,
        run_id: this.sessionId,
      })
      .catch(() => undefined);
  }

  private async searchMemories(query: string): Promise<string> {
    if (!this.client) return "";
    try {
      const response = await this.client.search(query, {
        filters: { user_id: this.userId },
        topK: 5,
      });
      const results = "results" in response ? response.results : [];
      const lines = (results ?? [])
        .map((r: { memory?: string }) => r.memory ?? "")
        .filter(Boolean);
      return lines.length > 0 ? lines.join("\n") : "";
    } catch (error) {
      this.logger.warn(
        `mem0 search failed: ${error instanceof Error ? error.message : String(error)}`
      );
      return "";
    }
  }
}
