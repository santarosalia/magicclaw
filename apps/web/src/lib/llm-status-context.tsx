"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export interface LlmStatusState {
  status: "loading" | "configured" | "not_configured" | "error";
  error?: string;
}

type LlmStatusResponse = {
  configured?: boolean;
  connected?: boolean;
  modelAvailable?: boolean;
  error?: string;
} | null;

function parseLlmStatus(data: LlmStatusResponse): LlmStatusState {
  if (!data) return { status: "not_configured" };
  if (!data.configured) return { status: "not_configured" };
  if (data.connected && data.modelAvailable !== false) return { status: "configured" };
  return {
    status: "error",
    error: data.error ?? "연결할 수 없습니다.",
  };
}

interface LlmStatusContextValue {
  llmState: LlmStatusState;
  refreshLlmStatus: () => void;
}

const LlmStatusContext = createContext<LlmStatusContextValue | null>(null);

export function LlmStatusProvider({ children }: { children: ReactNode }) {
  const [llmState, setLlmState] = useState<LlmStatusState>({
    status: "loading",
  });

  const refreshLlmStatus = useCallback(() => {
    const apiOrigin =
      process.env.NEXT_PUBLIC_API_ORIGIN ?? "http://localhost:4000";
    const url = apiOrigin.replace(/\/$/, "") + "/llm/status";
    setLlmState((prev) =>
      prev.status === "loading" ? prev : { status: "loading" }
    );
    fetch(url)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: LlmStatusResponse) => setLlmState(parseLlmStatus(data)))
      .catch(() =>
        setLlmState({ status: "error", error: "API에 연결할 수 없습니다." })
      );
  }, []);

  useEffect(() => {
    refreshLlmStatus();
  }, [refreshLlmStatus]);

  return (
    <LlmStatusContext.Provider value={{ llmState, refreshLlmStatus }}>
      {children}
    </LlmStatusContext.Provider>
  );
}

export function useLlmStatus(): LlmStatusContextValue {
  const ctx = useContext(LlmStatusContext);
  if (!ctx) {
    throw new Error("useLlmStatus must be used within LlmStatusProvider");
  }
  return ctx;
}
