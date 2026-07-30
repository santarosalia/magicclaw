export const DEFAULT_CONTEXT_WINDOW = 65536;

export type ContextWindowSource =
  | "api"
  | "heuristic"
  | "manual"
  | "fallback";

export interface ResolvedContextWindow {
  contextWindow: number;
  source: ContextWindowSource;
}

/** Known OpenAI-compatible public model context sizes (tokens). */
const MODEL_ID_CONTEXT_HEURISTICS: Array<{
  pattern: RegExp;
  contextWindow: number;
}> = [
  { pattern: /^gpt-5\.5/i, contextWindow: 400000 },
  { pattern: /^gpt-5\.4/i, contextWindow: 400000 },
  { pattern: /^gpt-5/i, contextWindow: 400000 },
  { pattern: /^gpt-4\.1/i, contextWindow: 1047576 },
  { pattern: /^gpt-4o/i, contextWindow: 128000 },
  { pattern: /^gpt-4-turbo/i, contextWindow: 128000 },
  { pattern: /^gpt-4(?!o)/i, contextWindow: 8192 },
  { pattern: /^gpt-3\.5/i, contextWindow: 16385 },
  { pattern: /^o[1-4]/i, contextWindow: 200000 },
  { pattern: /^o3/i, contextWindow: 200000 },
];

function positiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return null;
}

function readNested(
  obj: Record<string, unknown>,
  path: string[]
): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/** Pull context window from a /v1/models data[] entry when present. */
export function extractContextWindowFromModelEntry(
  entry: unknown
): number | null {
  if (!entry || typeof entry !== "object") return null;
  const obj = entry as Record<string, unknown>;

  const candidates: unknown[] = [
    obj.context_length,
    obj.max_model_len,
    obj.max_seq_len,
    obj.n_ctx,
    obj.max_context_length,
    readNested(obj, ["meta", "n_ctx_train"]),
    readNested(obj, ["meta", "max_model_len"]),
    readNested(obj, ["model_info", "context_length"]),
  ];

  for (const c of candidates) {
    const n = positiveInt(c);
    if (n) return n;
  }
  return null;
}

export function resolveContextWindowFromModelId(modelId: string): number | null {
  const id = modelId.trim();
  if (!id) return null;
  for (const { pattern, contextWindow } of MODEL_ID_CONTEXT_HEURISTICS) {
    if (pattern.test(id)) return contextWindow;
  }
  return null;
}

export function resolveModelContextWindow(input: {
  modelId: string;
  entry?: unknown;
}): ResolvedContextWindow {
  const fromApi = extractContextWindowFromModelEntry(input.entry);
  if (fromApi) {
    return { contextWindow: fromApi, source: "api" };
  }

  const fromHeuristic = resolveContextWindowFromModelId(input.modelId);
  if (fromHeuristic) {
    return { contextWindow: fromHeuristic, source: "heuristic" };
  }

  return { contextWindow: DEFAULT_CONTEXT_WINDOW, source: "fallback" };
}

export function findModelEntry(
  models: unknown[],
  modelId: string
): unknown | undefined {
  const target = modelId.trim().toLowerCase();
  return models.find((m) => {
    if (!m || typeof m !== "object") return false;
    const id = (m as { id?: unknown }).id;
    return typeof id === "string" && id.toLowerCase() === target;
  });
}
