import {
  DEFAULT_CONTEXT_WINDOW,
  extractContextWindowFromModelEntry,
  resolveContextWindowFromModelId,
  resolveModelContextWindow,
} from "./context-window.util.js";

describe("context-window.util", () => {
  it("extracts context_length from model entry", () => {
    expect(
      extractContextWindowFromModelEntry({
        id: "qwen",
        context_length: 131072,
      })
    ).toBe(131072);
  });

  it("extracts max_model_len and nested meta.n_ctx_train", () => {
    expect(
      extractContextWindowFromModelEntry({
        id: "vllm",
        max_model_len: 32768,
      })
    ).toBe(32768);
    expect(
      extractContextWindowFromModelEntry({
        id: "llama",
        meta: { n_ctx_train: 8192 },
      })
    ).toBe(8192);
  });

  it("resolves OpenAI model ids via heuristic", () => {
    expect(resolveContextWindowFromModelId("gpt-4o")).toBe(128000);
    expect(resolveContextWindowFromModelId("gpt-5.5")).toBeGreaterThan(100000);
    expect(resolveContextWindowFromModelId("unknown-local-model")).toBeNull();
  });

  it("prefers API entry over heuristic, then falls back", () => {
    expect(
      resolveModelContextWindow({
        modelId: "gpt-4o",
        entry: { id: "gpt-4o", max_model_len: 200000 },
      })
    ).toEqual({ contextWindow: 200000, source: "api" });

    expect(
      resolveModelContextWindow({
        modelId: "gpt-4o",
        entry: { id: "gpt-4o" },
      })
    ).toEqual({ contextWindow: 128000, source: "heuristic" });

    expect(
      resolveModelContextWindow({
        modelId: "custom-7b",
        entry: undefined,
      })
    ).toEqual({ contextWindow: DEFAULT_CONTEXT_WINDOW, source: "fallback" });
  });
});
