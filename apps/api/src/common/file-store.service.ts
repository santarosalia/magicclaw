import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Logger } from "@nestjs/common";

const MAGICCLAW_DIR = join(homedir(), ".magicclaw");

export class FileStoreService {
  private static readonly logger = new Logger(FileStoreService.name);

  protected ensureDirectory(): void {
    if (!existsSync(MAGICCLAW_DIR)) {
      mkdirSync(MAGICCLAW_DIR, { recursive: true });
    }
  }

  protected readFile<T>(filename: string, defaultValue: T): T {
    this.ensureDirectory();
    const filePath = join(MAGICCLAW_DIR, filename);
    if (!existsSync(filePath)) {
      return defaultValue;
    }
    try {
      const content = readFileSync(filePath, "utf-8");
      return JSON.parse(content) as T;
    } catch (error) {
      FileStoreService.logger.warn(
        `Failed to read ${filename}, using default value.`
      );
      FileStoreService.logger.debug(
        error instanceof Error ? error.stack : String(error)
      );
      return defaultValue;
    }
  }

  protected writeFile<T>(filename: string, data: T): void {
    this.ensureDirectory();
    const filePath = join(MAGICCLAW_DIR, filename);
    try {
      writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    } catch (error) {
      FileStoreService.logger.error(`Failed to write ${filename}`);
      FileStoreService.logger.error(
        error instanceof Error ? error.stack : String(error)
      );
      throw error;
    }
  }
}
