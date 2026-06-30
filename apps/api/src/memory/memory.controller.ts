import {
  Body,
  Controller,
  Get,
  Post,
  BadRequestException,
} from "@nestjs/common";
import { MemoryConfigStoreService } from "../store/memory-config-store.service.js";
import { MemoryManagerService } from "./memory-manager.service.js";
import { listBundledProviderNames } from "./providers/provider.registry.js";
import { createMemoryProvider } from "./providers/provider.registry.js";
import {
  defaultMem0OssConfig,
  mem0AvailabilityHint,
  resolveMem0Mode,
  validateMem0OssStructure,
  type Mem0Mode,
  type Mem0OssStoredConfig,
  type Mem0ProviderConfig,
} from "./providers/mem0-config.js";

@Controller("memory")
export class MemoryController {
  constructor(
    private readonly configStore: MemoryConfigStoreService,
    private readonly memoryManager: MemoryManagerService
  ) {}

  @Get("status")
  getStatus() {
    const config = this.configStore.getConfig();
    const status = this.memoryManager.getStatus();
    const bundled = listBundledProviderNames().map((name) => {
      const provider = createMemoryProvider(name, config);
      return {
        name,
        available: provider?.isAvailable() ?? false,
        hint: name === "mem0" ? mem0AvailabilityHint(config.mem0) : undefined,
      };
    });
    return { config, status, bundledProviders: bundled };
  }

  @Post("setup")
  setup(
    @Body()
    body: {
      provider?: string;
      memoryEnabled?: boolean;
      userProfileEnabled?: boolean;
      mem0?: Partial<Mem0ProviderConfig>;
    }
  ) {
    const config = this.configStore.getConfig();
    if (body.provider !== undefined) {
      if (body.provider && !listBundledProviderNames().includes(body.provider)) {
        throw new BadRequestException(`Unknown provider: ${body.provider}`);
      }
      config.provider = body.provider;
    }
    if (body.memoryEnabled !== undefined) config.memoryEnabled = body.memoryEnabled;
    if (body.userProfileEnabled !== undefined) {
      config.userProfileEnabled = body.userProfileEnabled;
    }
    if (body.mem0) {
      config.mem0 = mergeMem0Config(config.mem0, body.mem0);
    }
    this.configStore.saveConfig(config);
    return { ok: true, config };
  }

  @Post("mem0/setup")
  setupMem0(
    @Body()
    body: {
      mode?: Mem0Mode;
      agentId?: string;
      rerank?: boolean;
      oss?: Partial<Mem0OssStoredConfig>;
    }
  ) {
    const config = this.configStore.getConfig();
    const nextMem0 = mergeMem0Config(config.mem0, {
      ...(body.mode ? { mode: body.mode } : {}),
      ...(body.agentId !== undefined ? { agentId: body.agentId } : {}),
      ...(body.rerank !== undefined ? { rerank: body.rerank } : {}),
    });

    if (body.mode === "oss" && !nextMem0.oss) {
      nextMem0.oss = defaultMem0OssConfig();
    }
    if (body.oss) {
      nextMem0.oss = mergeOssConfig(nextMem0.oss ?? defaultMem0OssConfig(), body.oss);
    }

    if (resolveMem0Mode(nextMem0) === "oss") {
      const errors = validateMem0OssStructure(nextMem0.oss);
      if (errors.length > 0) {
        throw new BadRequestException(errors.join(" "));
      }
    }

    config.mem0 = nextMem0;
    this.configStore.saveConfig(config);
    return { ok: true, mem0: config.mem0 };
  }

  @Post("off")
  turnOff() {
    const config = this.configStore.getConfig();
    config.provider = "";
    this.configStore.saveConfig(config);
    return { ok: true, config };
  }
}

function mergeMem0Config(
  current: Mem0ProviderConfig | undefined,
  patch: Partial<Mem0ProviderConfig>
): Mem0ProviderConfig {
  const base: Mem0ProviderConfig = {
    mode: current?.mode ?? "platform",
    apiKeyEnv: current?.apiKeyEnv ?? "MEM0_API_KEY",
    agentId: current?.agentId ?? "magicclaw",
    rerank: current?.rerank ?? true,
    oss: current?.oss ?? defaultMem0OssConfig(),
  };

  return {
    ...base,
    ...patch,
    oss: patch.oss
      ? mergeOssConfig(base.oss ?? defaultMem0OssConfig(), patch.oss)
      : base.oss,
  };
}

function mergeOssConfig(
  current: Mem0OssStoredConfig,
  patch: Partial<Mem0OssStoredConfig>
): Mem0OssStoredConfig {
  return {
    ...current,
    ...patch,
    llm: patch.llm
      ? {
          provider: patch.llm.provider ?? current.llm.provider,
          config: { ...current.llm.config, ...patch.llm.config },
        }
      : current.llm,
    embedder: patch.embedder
      ? {
          provider: patch.embedder.provider ?? current.embedder.provider,
          config: { ...current.embedder.config, ...patch.embedder.config },
        }
      : current.embedder,
    vectorStore: patch.vectorStore
      ? {
          provider: patch.vectorStore.provider ?? current.vectorStore.provider,
          config: { ...current.vectorStore.config, ...patch.vectorStore.config },
        }
      : current.vectorStore,
  };
}
