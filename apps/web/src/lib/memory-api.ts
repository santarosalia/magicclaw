/** Next.js rewrite(`/api/*`) 경유 — CORS 없이 동일 출처로 API 호출 */
const apiBase = () => "/api";

export type Mem0Mode = "platform" | "oss";

export interface Mem0OssProviderBlock {
  provider: string;
  config: Record<string, string | number | boolean | undefined>;
}

export interface Mem0OssStoredConfig {
  llm: Mem0OssProviderBlock;
  embedder: Mem0OssProviderBlock;
  vectorStore: Mem0OssProviderBlock;
  historyDbPath?: string;
  disableHistory?: boolean;
}

export interface Mem0ProviderConfig {
  mode?: Mem0Mode;
  apiKeyEnv?: string;
  agentId?: string;
  rerank?: boolean;
  oss?: Mem0OssStoredConfig;
}

export interface MemoryStatusResponse {
  config: {
    memoryEnabled: boolean;
    userProfileEnabled: boolean;
    memoryCharLimit: number;
    userCharLimit: number;
    maxContextMessages: number;
    provider: string;
    mem0?: Mem0ProviderConfig;
  };
  status: {
    provider: string;
    externalAvailable: boolean;
    externalName: string | null;
  };
  bundledProviders: Array<{
    name: string;
    available: boolean;
    hint?: string;
  }>;
}

export async function getMemoryStatus(): Promise<MemoryStatusResponse> {
  const res = await fetch(`${apiBase()}/memory/status`);
  if (!res.ok) throw new Error("메모리 상태를 불러오지 못했습니다.");
  return res.json();
}

export async function setupMemory(body: {
  provider?: string;
  memoryEnabled?: boolean;
  userProfileEnabled?: boolean;
  mem0?: Partial<Mem0ProviderConfig>;
}): Promise<void> {
  const res = await fetch(`${apiBase()}/memory/setup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("메모리 설정을 저장하지 못했습니다.");
}

export async function setupMem0(body: {
  mode?: Mem0Mode;
  agentId?: string;
  rerank?: boolean;
  oss?: Partial<Mem0OssStoredConfig>;
}): Promise<void> {
  const res = await fetch(`${apiBase()}/memory/mem0/setup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Mem0 설정을 저장하지 못했습니다.");
  }
}

export async function turnOffMemoryProvider(): Promise<void> {
  const res = await fetch(`${apiBase()}/memory/off`, { method: "POST" });
  if (!res.ok) throw new Error("메모리 provider를 끄지 못했습니다.");
}
