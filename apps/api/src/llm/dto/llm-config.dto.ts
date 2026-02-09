export class CreateLlmConfigDto {
  name!: string;
  baseURL!: string;
  model!: string;
  apiKey?: string;
}

export class UpdateLlmConfigDto {
  name?: string;
  baseURL?: string;
  model?: string;
  apiKey?: string;
}

export interface LlmConfig {
  id: string;
  name: string;
  baseURL: string;
  model: string;
  apiKey?: string;
  createdAt: string;
  isDefault?: boolean;
}
