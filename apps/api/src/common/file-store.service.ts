import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const MAGICCLAW_DIR = join(homedir(), '.magicclaw');

export class FileStoreService {
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
      const content = readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as T;
    } catch (error) {
      console.error(`Failed to read ${filename}:`, error);
      return defaultValue;
    }
  }

  protected writeFile<T>(filename: string, data: T): void {
    this.ensureDirectory();
    const filePath = join(MAGICCLAW_DIR, filename);
    try {
      writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      console.error(`Failed to write ${filename}:`, error);
      throw error;
    }
  }
}
