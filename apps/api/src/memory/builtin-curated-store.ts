import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { getMemoriesDir } from "../common/magicclaw-home.js";

const ENTRY_DELIMITER = "\n§\n";

export type MemoryTarget = "memory" | "user";

export interface MemoryMutationResult {
  success: boolean;
  error?: string;
  message?: string;
  currentEntries?: string[];
  usage?: string;
}

export class BuiltinCuratedStore {
  private memoryEntries: string[] = [];
  private userEntries: string[] = [];
  private systemPromptSnapshot: { memory: string; user: string } = {
    memory: "",
    user: "",
  };

  constructor(
    private readonly userId: string,
    private memoryCharLimit: number,
    private userCharLimit: number,
    private memoryEnabled: boolean,
    private userProfileEnabled: boolean
  ) {}

  updateConfig(
    memoryEnabled: boolean,
    userProfileEnabled: boolean,
    memoryCharLimit: number,
    userCharLimit: number
  ): void {
    this.memoryEnabled = memoryEnabled;
    this.userProfileEnabled = userProfileEnabled;
    this.memoryCharLimit = memoryCharLimit;
    this.userCharLimit = userCharLimit;
  }

  loadFromDisk(): void {
    const memDir = getMemoriesDir(this.userId);
    mkdirSync(memDir, { recursive: true });

    this.memoryEntries = this.deduplicate(
      this.readFile(join(memDir, "MEMORY.md"))
    );
    this.userEntries = this.deduplicate(this.readFile(join(memDir, "USER.md")));

    this.systemPromptSnapshot = {
      memory: this.memoryEnabled
        ? this.renderBlock("memory", this.memoryEntries)
        : "",
      user: this.userProfileEnabled
        ? this.renderBlock("user", this.userEntries)
        : "",
    };
  }

  getSystemPromptBlock(): string {
    const parts = [
      this.systemPromptSnapshot.memory,
      this.systemPromptSnapshot.user,
    ].filter(Boolean);
    return parts.join("\n\n");
  }

  getLiveEntries(target: MemoryTarget): string[] {
    return target === "user" ? [...this.userEntries] : [...this.memoryEntries];
  }

  applyBatch(
    target: MemoryTarget,
    operations: Array<{
      action: "add" | "replace" | "remove";
      content?: string;
      old_text?: string;
    }>
  ): MemoryMutationResult {
    if (!operations.length) {
      return { success: false, error: "operations list is empty." };
    }

    const working = [...this.entriesFor(target)];
    const limit = this.charLimit(target);

    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];
      const pos = `Operation ${i + 1} (${op.action})`;
      const content = op.content?.trim() ?? "";
      const oldText = op.old_text?.trim() ?? "";

      if (op.action === "add") {
        if (!content) {
          return this.batchError(target, `${pos}: content is required.`);
        }
        if (!working.includes(content)) working.push(content);
        continue;
      }

      if (op.action === "replace") {
        if (!oldText) {
          return this.batchError(target, `${pos}: old_text is required.`);
        }
        if (!content) {
          return this.batchError(
            target,
            `${pos}: content is required (use remove to delete).`
          );
        }
        const matches = working
          .map((entry, index) => ({ entry, index }))
          .filter(({ entry }) => entry.includes(oldText));
        if (matches.length === 0) {
          return this.batchError(target, `${pos}: no entry matched '${oldText}'.`);
        }
        if (new Set(matches.map(({ entry }) => entry)).size > 1) {
          return this.batchError(
            target,
            `${pos}: '${oldText}' matched multiple entries — be more specific.`
          );
        }
        working[matches[0].index] = content;
        continue;
      }

      if (op.action === "remove") {
        if (!oldText) {
          return this.batchError(target, `${pos}: old_text is required.`);
        }
        const matches = working
          .map((entry, index) => ({ entry, index }))
          .filter(({ entry }) => entry.includes(oldText));
        if (matches.length === 0) {
          return this.batchError(target, `${pos}: no entry matched '${oldText}'.`);
        }
        if (new Set(matches.map(({ entry }) => entry)).size > 1) {
          return this.batchError(
            target,
            `${pos}: '${oldText}' matched multiple entries — be more specific.`
          );
        }
        working.splice(matches[0].index, 1);
        continue;
      }

      return this.batchError(
        target,
        `${pos}: unknown action. Use add, replace, or remove.`
      );
    }

    const newTotal = this.joinEntries(working).length;
    if (newTotal > limit) {
      return {
        success: false,
        error: `After applying all ${operations.length} operations, memory would be at ${newTotal}/${limit} chars — over the limit. Remove or shorten more entries in the same batch.`,
        currentEntries: this.entriesFor(target),
        usage: `${this.charCount(target)}/${limit}`,
      };
    }

    this.setEntries(target, working);
    this.saveToDisk(target);
    return this.successResponse(
      target,
      `Applied ${operations.length} operation(s).`
    );
  }

  private batchError(target: MemoryTarget, message: string): MemoryMutationResult {
    const limit = this.charLimit(target);
    return {
      success: false,
      error: `${message} No operations were applied (batch is all-or-nothing).`,
      currentEntries: this.entriesFor(target),
      usage: `${this.charCount(target)}/${limit}`,
    };
  }

  add(target: MemoryTarget, content: string): MemoryMutationResult {
    const trimmed = content.trim();
    if (!trimmed) return { success: false, error: "Content cannot be empty." };

    const entries = this.entriesFor(target);
    if (entries.includes(trimmed)) {
      return this.successResponse(target, "Entry already exists (no duplicate added).");
    }

    const newEntries = [...entries, trimmed];
    const limit = this.charLimit(target);
    const newTotal = this.joinEntries(newEntries).length;
    if (newTotal > limit) {
      const current = this.charCount(target);
      return {
        success: false,
        error: `Memory at ${current}/${limit} chars. Adding this entry (${trimmed.length} chars) would exceed the limit.`,
        currentEntries: entries,
        usage: `${current}/${limit}`,
      };
    }

    this.setEntries(target, newEntries);
    this.saveToDisk(target);
    return this.successResponse(target, "Entry added.");
  }

  replace(
    target: MemoryTarget,
    oldText: string,
    newContent: string
  ): MemoryMutationResult {
    const oldTrimmed = oldText.trim();
    const newTrimmed = newContent.trim();
    if (!oldTrimmed) return { success: false, error: "old_text cannot be empty." };
    if (!newTrimmed) {
      return {
        success: false,
        error: "new_content cannot be empty. Use 'remove' to delete entries.",
      };
    }

    const entries = this.entriesFor(target);
    const idx = entries.findIndex((e) => e.includes(oldTrimmed));
    if (idx < 0) {
      return {
        success: false,
        error: `No entry contains substring: ${oldTrimmed}`,
        currentEntries: entries,
      };
    }

    const newEntries = [...entries];
    newEntries[idx] = newTrimmed;
    const limit = this.charLimit(target);
    const newTotal = this.joinEntries(newEntries).length;
    if (newTotal > limit) {
      return {
        success: false,
        error: `Replacement would exceed char limit (${limit}).`,
        currentEntries: entries,
      };
    }

    this.setEntries(target, newEntries);
    this.saveToDisk(target);
    return this.successResponse(target, "Entry replaced.");
  }

  remove(target: MemoryTarget, oldText: string): MemoryMutationResult {
    const oldTrimmed = oldText.trim();
    if (!oldTrimmed) return { success: false, error: "old_text cannot be empty." };

    const entries = this.entriesFor(target);
    const idx = entries.findIndex((e) => e.includes(oldTrimmed));
    if (idx < 0) {
      return {
        success: false,
        error: `No entry contains substring: ${oldTrimmed}`,
        currentEntries: entries,
      };
    }

    const newEntries = entries.filter((_, i) => i !== idx);
    this.setEntries(target, newEntries);
    this.saveToDisk(target);
    return this.successResponse(target, "Entry removed.");
  }

  private successResponse(
    target: MemoryTarget,
    message: string
  ): MemoryMutationResult {
    return {
      success: true,
      message,
      currentEntries: this.entriesFor(target),
      usage: `${this.charCount(target)}/${this.charLimit(target)}`,
    };
  }

  private renderBlock(target: MemoryTarget, entries: string[]): string {
    if (entries.length === 0) return "";
    const label = target === "user" ? "USER PROFILE" : "AGENT MEMORY";
    const limit = this.charLimit(target);
    const used = this.joinEntries(entries).length;
    const pct = limit > 0 ? Math.round((used / limit) * 100) : 0;
    return `## ${label} [${pct}% — ${used}/${limit} chars]\n${entries.join("\n\n")}`;
  }

  private pathFor(target: MemoryTarget): string {
    const memDir = getMemoriesDir(this.userId);
    return join(memDir, target === "user" ? "USER.md" : "MEMORY.md");
  }

  private readFile(path: string): string[] {
    if (!existsSync(path)) return [];
    const raw = readFileSync(path, "utf-8").trim();
    if (!raw) return [];
    return raw.split(ENTRY_DELIMITER).map((e) => e.trim()).filter(Boolean);
  }

  private saveToDisk(target: MemoryTarget): void {
    const path = this.pathFor(target);
    mkdirSync(join(path, ".."), { recursive: true });
    const content = this.joinEntries(this.entriesFor(target));
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, content, "utf-8");
    renameSync(tmp, path);
  }

  private joinEntries(entries: string[]): string {
    return entries.join(ENTRY_DELIMITER);
  }

  private entriesFor(target: MemoryTarget): string[] {
    return target === "user" ? this.userEntries : this.memoryEntries;
  }

  private setEntries(target: MemoryTarget, entries: string[]): void {
    if (target === "user") this.userEntries = entries;
    else this.memoryEntries = entries;
  }

  private charCount(target: MemoryTarget): number {
    return this.joinEntries(this.entriesFor(target)).length;
  }

  private charLimit(target: MemoryTarget): number {
    return target === "user" ? this.userCharLimit : this.memoryCharLimit;
  }

  private deduplicate(entries: string[]): string[] {
    return [...new Set(entries)];
  }
}
