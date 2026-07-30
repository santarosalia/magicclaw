import type { ContextWindowSource } from "../context-window.util.js";

export class CreateLlmConfigDto {
  name!: string;
  baseURL!: string;
  model!: string;
  apiKey?: string;
  /** Manual context window override (tokens). */
  contextWindow?: number;
}

export class UpdateLlmConfigDto {
  name?: string;
  baseURL?: string;
  model?: string;
  apiKey?: string;
  /** Manual context window override (tokens). Sets source to manual. */
  contextWindow?: number;
}

export interface LlmConfig {
  id: string;
  name: string;
  baseURL: string;
  model: string;
  apiKey?: string;
  createdAt: string;
  isDefault?: boolean;
  contextWindow?: number;
  contextWindowSource?: ContextWindowSource;
  contextWindowCheckedAt?: string;
}
