import type { MemoryProvider } from "../memory-provider.interface.js";
import { Mem0MemoryProvider } from "./mem0.provider.js";

export type MemoryProviderFactory = () => MemoryProvider;

const BUNDLED_PROVIDERS: Record<string, MemoryProviderFactory> = {
  mem0: () => new Mem0MemoryProvider(),
};

export function createMemoryProvider(name: string): MemoryProvider | null {
  const factory = BUNDLED_PROVIDERS[name];
  return factory ? factory() : null;
}

export function listBundledProviderNames(): string[] {
  return Object.keys(BUNDLED_PROVIDERS);
}
