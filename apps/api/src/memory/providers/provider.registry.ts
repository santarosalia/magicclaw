import type { MemoryConfig } from "../../store/memory-config-store.service.js";
import type { MemoryProvider } from "../memory-provider.interface.js";
import { Mem0MemoryProvider } from "./mem0.provider.js";

export type MemoryProviderFactory = (
  memoryConfig?: MemoryConfig
) => MemoryProvider;

const BUNDLED_PROVIDERS: Record<string, MemoryProviderFactory> = {
  mem0: (memoryConfig) => new Mem0MemoryProvider(memoryConfig?.mem0),
};

export function createMemoryProvider(
  name: string,
  memoryConfig?: MemoryConfig
): MemoryProvider | null {
  const factory = BUNDLED_PROVIDERS[name];
  return factory ? factory(memoryConfig) : null;
}

export function listBundledProviderNames(): string[] {
  return Object.keys(BUNDLED_PROVIDERS);
}
