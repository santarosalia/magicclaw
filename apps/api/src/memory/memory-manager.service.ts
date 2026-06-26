import { Injectable, Logger } from "@nestjs/common";
import type { MemoryProvider, SyncTurnInput } from "./memory-provider.interface.js";
import { MemoryConfigStoreService } from "../store/memory-config-store.service.js";
import { BuiltinCuratedStore } from "./builtin-curated-store.js";
import { buildMemoryContextBlock } from "./memory-context.util.js";
import { BackgroundQueue } from "./background-queue.js";
import { createMemoryTool } from "./memory-tool.factory.js";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import { createMemoryProvider } from "./providers/provider.registry.js";
import { extractMemoryTarget, extractProfileFacts } from "./builtin-user-facts.util.js";
import { turnWroteBuiltinMemory } from "./builtin-turn-sync.util.js";

@Injectable()
export class MemoryManagerService {
  private readonly logger = new Logger(MemoryManagerService.name);
  private readonly builtinStores = new Map<string, BuiltinCuratedStore>();
  private externalProvider: MemoryProvider | null = null;
  private currentSessionId = "";
  private readonly queue = new BackgroundQueue();

  constructor(private readonly configStore: MemoryConfigStoreService) {}

  async initializeAll(userId: string, sessionId: string): Promise<void> {
    this.currentSessionId = sessionId;

    const config = this.configStore.getConfig();
    const store = this.getOrCreateBuiltinStore(userId, config);
    store.loadFromDisk();

    if (this.externalProvider) {
      await this.externalProvider.shutdown().catch(() => undefined);
      this.externalProvider = null;
    }

    if (config.provider) {
      const provider = createMemoryProvider(config.provider, config);
      if (!provider) {
        this.logger.warn(`Unknown memory provider: ${config.provider}`);
      } else if (!provider.isAvailable()) {
        this.logger.warn(`Memory provider unavailable: ${config.provider}`);
      } else {
        this.externalProvider = provider;
        await provider.initialize({
          userId,
          sessionId,
          channel: "agent",
        });
      }
    }

  }

  createMemoryToolForUser(userId: string): DynamicStructuredTool {
    return createMemoryTool(
      () => this.builtinStores.get(userId) ?? null,
      (target, content) => this.notifyMemoryToolWrite(target, content)
    );
  }

  buildSystemPromptBlock(userId: string): string {
    const store = this.builtinStores.get(userId);
    const builtin = store?.getSystemPromptBlock() ?? "";
    const external = this.externalProvider?.systemPromptBlock() ?? "";
    return [builtin, external].filter(Boolean).join("\n\n");
  }

  buildBuiltinTurnContext(userId: string): string {
    const store = this.builtinStores.get(userId);
    if (!store) return "";
    store.loadFromDisk();
    const block = store.getSystemPromptBlock();
    return block ? buildMemoryContextBlock(block) : "";
  }

  refreshBuiltinBlocks(userId: string): {
    systemMemoryBlock: string;
    memoryContext: string;
  } {
    const store = this.builtinStores.get(userId);
    if (store) store.loadFromDisk();
    return {
      systemMemoryBlock: this.buildSystemPromptBlock(userId),
      memoryContext: this.buildBuiltinTurnContext(userId),
    };
  }

  syncBuiltinFromTurn(input: SyncTurnInput): void {
    const store = this.builtinStores.get(input.userId);
    if (!store) return;
    if (turnWroteBuiltinMemory(input.messages ?? [])) return;

    const facts = extractProfileFacts(input.userContent);
    if (facts.length === 0) return;

    const target = extractMemoryTarget(input.userContent);
    for (const fact of facts) {
      const result = store.add(target, fact);
      if (!result.success) {
        this.logger.debug(
          `builtin auto-ingest skipped: ${result.error ?? "unknown"}`
        );
      }
    }
  }

  async prefetchAll(query: string, sessionId = ""): Promise<string> {
    const clean = query.trim();
    if (!clean) return "";

    const parts: string[] = [];
    if (this.externalProvider) {
      try {
        const result = await this.externalProvider.prefetch(clean, sessionId);
        if (result?.trim()) parts.push(result.trim());
      } catch (error) {
        this.logger.warn(
          `prefetch failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    return buildMemoryContextBlock(parts.join("\n\n"));
  }

  syncAll(input: SyncTurnInput): void {
    this.queue.enqueue(async () => {
      if (this.externalProvider) {
        try {
          this.externalProvider.syncTurn(input);
        } catch (error) {
          this.logger.warn(
            `syncTurn failed: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    });
  }

  queuePrefetchAll(query: string, sessionId = ""): void {
    const clean = query.trim();
    if (!clean || !this.externalProvider) return;

    this.queue.enqueue(async () => {
      try {
        this.externalProvider?.queuePrefetch(clean, sessionId);
      } catch (error) {
        this.logger.warn(
          `queuePrefetch failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });
  }

  notifyMemoryToolWrite(target: "memory" | "user", content: string): void {
    this.externalProvider?.onMemoryWrite?.(target, content);
  }

  async onPreCompress(sessionId: string): Promise<void> {
    if (this.externalProvider?.onPreCompress) {
      await this.externalProvider.onPreCompress(sessionId);
    }
  }

  async shutdownAll(): Promise<void> {
    await this.queue.drain();
    if (this.externalProvider) {
      await this.externalProvider.shutdown().catch(() => undefined);
      this.externalProvider = null;
    }
  }

  getBuiltinStore(userId: string): BuiltinCuratedStore | undefined {
    return this.builtinStores.get(userId);
  }

  getStatus(): {
    provider: string;
    externalAvailable: boolean;
    externalName: string | null;
  } {
    const config = this.configStore.getConfig();
    return {
      provider: config.provider,
      externalAvailable: this.externalProvider?.isAvailable() ?? false,
      externalName: this.externalProvider?.name ?? null,
    };
  }

  private getOrCreateBuiltinStore(
    userId: string,
    config: ReturnType<MemoryConfigStoreService["getConfig"]>
  ): BuiltinCuratedStore {
    let store = this.builtinStores.get(userId);
    if (!store) {
      store = new BuiltinCuratedStore(
        userId,
        config.memoryCharLimit,
        config.userCharLimit,
        config.memoryEnabled,
        config.userProfileEnabled
      );
      this.builtinStores.set(userId, store);
      return store;
    }

    store.updateConfig(
      config.memoryEnabled,
      config.userProfileEnabled,
      config.memoryCharLimit,
      config.userCharLimit
    );
    return store;
  }
}
