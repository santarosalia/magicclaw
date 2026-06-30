import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Injectable } from "@nestjs/common";
import { getMagicClawHome } from "../common/magicclaw-home.js";
import {
  DEFAULT_CURATOR_CONFIG,
  type CuratorConfig,
} from "../skills/curator-config.js";

@Injectable()
export class CuratorConfigStoreService {
  private path(): string {
    return join(getMagicClawHome(), "curator-config.json");
  }

  getConfig(): CuratorConfig {
    const filePath = this.path();
    if (!existsSync(filePath)) {
      return { ...DEFAULT_CURATOR_CONFIG };
    }
    try {
      const raw = JSON.parse(readFileSync(filePath, "utf8")) as Partial<CuratorConfig>;
      return { ...DEFAULT_CURATOR_CONFIG, ...raw };
    } catch {
      return { ...DEFAULT_CURATOR_CONFIG };
    }
  }

  saveConfig(config: CuratorConfig): void {
    mkdirSync(getMagicClawHome(), { recursive: true });
    writeFileSync(this.path(), JSON.stringify(config, null, 2), "utf8");
  }
}
