import { Injectable } from "@nestjs/common";
import { FileStoreService } from "../common/file-store.service.js";

export interface MemoryConfig {
  memoryEnabled: boolean;
  userProfileEnabled: boolean;
  memoryCharLimit: number;
  userCharLimit: number;
  maxContextMessages: number;
  provider: string;
  mem0?: {
    apiKeyEnv?: string;
  };
}

const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  memoryEnabled: true,
  userProfileEnabled: true,
  memoryCharLimit: 2200,
  userCharLimit: 1375,
  maxContextMessages: 40,
  provider: "",
  mem0: { apiKeyEnv: "MEM0_API_KEY" },
};

@Injectable()
export class MemoryConfigStoreService extends FileStoreService {
  getConfig(): MemoryConfig {
    return this.readFile("memory-config.json", DEFAULT_MEMORY_CONFIG);
  }

  saveConfig(config: MemoryConfig): void {
    this.writeFile("memory-config.json", config);
  }
}
