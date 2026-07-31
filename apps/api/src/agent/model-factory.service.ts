import { Injectable } from "@nestjs/common";
import { ChatOpenAI } from "@langchain/openai";
import { LlmStoreService } from "../store/llm-store.service.js";
import { shouldUseResponsesApi } from "./api-mode.util.js";

@Injectable()
export class ModelFactoryService {
  constructor(private readonly llmStore: LlmStoreService) {}

  getDefaultModel(): string {
    return (
      this.llmStore.findDefault()?.model ??
      process.env.AGENT_DEFAULT_MODEL ??
      "gpt-4o-mini"
    );
  }

  create(model?: string): ChatOpenAI {
    const defaultConfig = this.llmStore.findDefault();
    if (!defaultConfig) {
      throw new Error(
        "LLM 설정이 없습니다. LLM 관리 페이지에서 설정을 추가해주세요."
      );
    }
    const modelId = model ?? defaultConfig.model;
    const baseURL = defaultConfig.baseURL?.trim() || undefined;
    const useResponsesApi = shouldUseResponsesApi({
      baseURL,
      model: modelId,
    });
    return new ChatOpenAI({
      model: modelId,
      // Responses API + streaming tool loops can drop/mis-pair function_call
      // outputs ("No tool output found for function call"). Keep streaming for
      // chat-completions hosts only.
      streaming: !useResponsesApi,
      maxTokens: Number(process.env.AGENT_MAX_OUTPUT_TOKENS ?? 4096),
      apiKey: defaultConfig.apiKey || "not-needed",
      useResponsesApi,
      configuration: baseURL ? { baseURL } : undefined,
    });
  }

  /** Cached context window from the active LLM config, if known. */
  getActiveContextWindow(): number | undefined {
    const window = this.llmStore.findDefault()?.contextWindow;
    if (window !== undefined && Number.isFinite(window) && window > 0) {
      return Math.floor(window);
    }
    return undefined;
  }
}
