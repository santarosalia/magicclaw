const apiOrigin = () =>
  (process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://localhost:4000").replace(
    /\/$/,
    ""
  );

export interface MemoryStatusResponse {
  config: {
    memoryEnabled: boolean;
    userProfileEnabled: boolean;
    memoryCharLimit: number;
    userCharLimit: number;
    maxContextMessages: number;
    provider: string;
  };
  status: {
    provider: string;
    externalAvailable: boolean;
    externalName: string | null;
  };
  bundledProviders: Array<{ name: string; available: boolean }>;
}

export async function getMemoryStatus(): Promise<MemoryStatusResponse> {
  const res = await fetch(`${apiOrigin()}/memory/status`);
  if (!res.ok) throw new Error("메모리 상태를 불러오지 못했습니다.");
  return res.json();
}

export async function setupMemory(body: {
  provider?: string;
  memoryEnabled?: boolean;
  userProfileEnabled?: boolean;
}): Promise<void> {
  const res = await fetch(`${apiOrigin()}/memory/setup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("메모리 설정을 저장하지 못했습니다.");
}

export async function turnOffMemoryProvider(): Promise<void> {
  const res = await fetch(`${apiOrigin()}/memory/off`, { method: "POST" });
  if (!res.ok) throw new Error("메모리 provider를 끄지 못했습니다.");
}
