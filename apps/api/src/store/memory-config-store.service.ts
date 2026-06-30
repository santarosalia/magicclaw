import { Injectable } from "@nestjs/common";
import { FileStoreService } from "../common/file-store.service.js";
import {
  defaultMem0OssConfig,
  type Mem0ProviderConfig,
} from "../memory/providers/mem0-config.js";

export interface MemoryConfig {
  memoryEnabled: boolean;
  userProfileEnabled: boolean;
  memoryCharLimit: number;
  userCharLimit: number;
  maxContextMessages: number;
  provider: string;
  mem0?: Mem0ProviderConfig;
}

const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  memoryEnabled: true,
  userProfileEnabled: true,
  memoryCharLimit: 2200,
  userCharLimit: 1375,
  maxContextMessages: 40,
  provider: "",
  mem0: {
    mode: "platform",
    apiKeyEnv: "MEM0_API_KEY",
    agentId: "magicclaw",
    rerank: true,
    oss: defaultMem0OssConfig(),
  },
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
