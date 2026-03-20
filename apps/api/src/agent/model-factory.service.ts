import { Injectable } from "@nestjs/common";
import { ChatOpenAI } from "@langchain/openai";
import { LlmStoreService } from "../store/llm-store.service.js";

@Injectable()
export class ModelFactoryService {
  constructor(private readonly llmStore: LlmStoreService) {}

  getDefaultModel(): string {
    return this.llmStore.findDefault()?.model ?? process.env.AGENT_DEFAULT_MODEL ?? "gpt-4o-mini";
  }

  create(model?: string): ChatOpenAI {
    const defaultConfig = this.llmStore.findDefault();
    if (!defaultConfig) {
      throw new Error("LLM 설정이 없습니다. LLM 관리 페이지에서 설정을 추가해주세요.");
    }
    const modelId = model ?? defaultConfig.model;
    return new ChatOpenAI({
      model: modelId,
      apiKey: defaultConfig.apiKey || "not-needed",
      configuration: defaultConfig.baseURL ? { baseURL: defaultConfig.baseURL } : undefined,
    });
  }
}
