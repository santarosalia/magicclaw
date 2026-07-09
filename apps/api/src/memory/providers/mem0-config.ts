import { join, resolve } from "node:path";
import {
  expandUserPath,
  getMagicClawHome,
} from "../../common/magicclaw-home.js";

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

export interface Mem0OssMemoryConfig {
  version: string;
  llm: Mem0OssProviderBlock;
  embedder: Mem0OssProviderBlock;
  vectorStore: Mem0OssProviderBlock;
  historyDbPath?: string;
  disableHistory?: boolean;
}

const KNOWN_EMBEDDING_DIMS: Record<string, number> = {
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 3072,
  "text-embedding-ada-002": 1536,
  "nomic-embed-text": 768,
};

const LLM_PROVIDERS = new Set(["openai", "ollama"]);
const EMBEDDER_PROVIDERS = new Set(["openai", "ollama"]);
const VECTOR_PROVIDERS = new Set(["memory", "qdrant", "pgvector"]);

export function defaultMem0OssConfig(): Mem0OssStoredConfig {
  const home = getMagicClawHome();
  return {
    llm: {
      provider: "openai",
      config: {
        apiKeyEnv: "OPENAI_API_KEY",
        model: "gpt-4o-mini",
      },
    },
    embedder: {
      provider: "openai",
      config: {
        apiKeyEnv: "OPENAI_API_KEY",
        model: "text-embedding-3-small",
        embeddingDims: 1536,
      },
    },
    vectorStore: {
      provider: "memory",
      config: {
        collectionName: "magicclaw_memories",
        dimension: 1536,
      },
    },
    historyDbPath: join(home, "mem0-history.db"),
    disableHistory: false,
  };
}

export function resolveMem0Mode(config?: Mem0ProviderConfig): Mem0Mode {
  const envMode = process.env.MEM0_MODE?.trim();
  if (envMode === "oss" || envMode === "platform") {
    return envMode;
  }
  return config?.mode === "oss" ? "oss" : "platform";
}

export function resolveMem0ApiKey(config?: Mem0ProviderConfig): string {
  const envName = config?.apiKeyEnv?.trim() || "MEM0_API_KEY";
  return process.env[envName]?.trim() ?? process.env.MEM0_API_KEY?.trim() ?? "";
}

function resolveBlockApiKey(
  block: Mem0OssProviderBlock,
  fallbackEnv = "OPENAI_API_KEY"
): string {
  const cfg = block.config ?? {};
  const envName =
    (typeof cfg.apiKeyEnv === "string" && cfg.apiKeyEnv.trim()) || fallbackEnv;
  if (typeof cfg.apiKey === "string" && cfg.apiKey.trim()) {
    return cfg.apiKey.trim();
  }
  return process.env[envName]?.trim() ?? "";
}

function embeddingDimsForModel(model: unknown): number | undefined {
  if (typeof model !== "string") return undefined;
  return KNOWN_EMBEDDING_DIMS[model];
}

export function validateMem0OssStructure(
  oss: Mem0OssStoredConfig | undefined
): string[] {
  if (!oss) return ["OSS 설정이 없습니다."];

  const errors: string[] = [];
  const llm = oss.llm?.provider?.trim();
  const embedder = oss.embedder?.provider?.trim();
  const vector = oss.vectorStore?.provider?.trim();

  if (!llm || !LLM_PROVIDERS.has(llm)) {
    errors.push(`LLM provider는 ${[...LLM_PROVIDERS].join(", ")} 중 하나여야 합니다.`);
  }
  if (!embedder || !EMBEDDER_PROVIDERS.has(embedder)) {
    errors.push(
      `Embedder provider는 ${[...EMBEDDER_PROVIDERS].join(", ")} 중 하나여야 합니다.`
    );
  }
  if (!vector || !VECTOR_PROVIDERS.has(vector)) {
    errors.push(
      `Vector store는 ${[...VECTOR_PROVIDERS].join(", ")} 중 하나여야 합니다.`
    );
  }

  if (vector === "pgvector") {
    const cfg = oss.vectorStore.config ?? {};
    if (!cfg.user) {
      errors.push("PGVector에는 user 설정이 필요합니다.");
    }
  }

  return errors;
}

export function validateMem0OssConfig(
  oss: Mem0OssStoredConfig | undefined
): string[] {
  const errors = validateMem0OssStructure(oss);
  if (errors.length > 0 || !oss) return errors;

  const llm = oss.llm.provider.trim();
  const embedder = oss.embedder.provider.trim();

  if (llm === "openai" && !resolveBlockApiKey(oss.llm)) {
    errors.push("OSS OpenAI LLM에는 OPENAI_API_KEY(또는 apiKeyEnv)가 필요합니다.");
  }
  if (embedder === "openai" && !resolveBlockApiKey(oss.embedder)) {
    errors.push(
      "OSS OpenAI Embedder에는 OPENAI_API_KEY(또는 apiKeyEnv)가 필요합니다."
    );
  }

  return errors;
}

export function isMem0Available(config?: Mem0ProviderConfig): boolean {
  const mode = resolveMem0Mode(config);
  if (mode === "platform") {
    return Boolean(resolveMem0ApiKey(config));
  }
  return validateMem0OssConfig(config?.oss ?? defaultMem0OssConfig()).length === 0;
}

export function buildMem0OssMemoryConfig(
  stored: Mem0OssStoredConfig
): Mem0OssMemoryConfig {
  const llmConfig = { ...stored.llm.config };
  const embedderConfig = { ...stored.embedder.config };
  const vectorConfig = { ...stored.vectorStore.config };

  const llmApiKey = resolveBlockApiKey(stored.llm);
  if (llmApiKey) llmConfig.apiKey = llmApiKey;
  delete llmConfig.apiKeyEnv;

  const embedderApiKey = resolveBlockApiKey(stored.embedder);
  if (embedderApiKey) embedderConfig.apiKey = embedderApiKey;
  delete embedderConfig.apiKeyEnv;

  const model = embedderConfig.model;
  const dims =
    typeof embedderConfig.embeddingDims === "number"
      ? embedderConfig.embeddingDims
      : embeddingDimsForModel(model);
  if (dims && vectorConfig.dimension === undefined) {
    vectorConfig.dimension = dims;
  }

  if (stored.vectorStore.provider === "qdrant") {
    if (typeof vectorConfig.path === "string") {
      vectorConfig.path = expandUserPath(vectorConfig.path);
    }
    if (!vectorConfig.path && !vectorConfig.url && !vectorConfig.host) {
      vectorConfig.path = join(getMagicClawHome(), "mem0_qdrant");
    }
  }

  const historyDbPath = resolve(
    expandUserPath(
      stored.historyDbPath?.trim() || join(getMagicClawHome(), "mem0-history.db")
    )
  );

  return {
    version: "v1.1",
    llm: {
      provider: stored.llm.provider,
      config: llmConfig,
    },
    embedder: {
      provider: stored.embedder.provider,
      config: embedderConfig,
    },
    vectorStore: {
      provider: stored.vectorStore.provider,
      config: vectorConfig,
    },
    historyDbPath,
    disableHistory: stored.disableHistory ?? false,
  };
}

export function mem0AvailabilityHint(config?: Mem0ProviderConfig): string {
  const mode = resolveMem0Mode(config);
  if (mode === "platform") {
    return resolveMem0ApiKey(config) ? "platform" : "platform (키 없음)";
  }
  const errors = validateMem0OssConfig(config?.oss ?? defaultMem0OssConfig());
  return errors.length === 0 ? "oss" : `oss (${errors[0]})`;
}
