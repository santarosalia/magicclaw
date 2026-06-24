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
      const provider = createMemoryProvider(name);
      return {
        name,
        available: provider?.isAvailable() ?? false,
      };
    });
    return { config, status, bundledProviders: bundled };
  }

  @Post("setup")
  setup(@Body() body: { provider?: string; memoryEnabled?: boolean; userProfileEnabled?: boolean }) {
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
    this.configStore.saveConfig(config);
    return { ok: true, config };
  }

  @Post("off")
  turnOff() {
    const config = this.configStore.getConfig();
    config.provider = "";
    this.configStore.saveConfig(config);
    return { ok: true, config };
  }
}
