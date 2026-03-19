import { Injectable, OnModuleInit } from "@nestjs/common";
import { FileStoreService } from "../common/file-store.service.js";

export type TelegramDmPolicy = "pairing" | "allowlist" | "open" | "disabled";

export interface TelegramMessengerConfig {
  botToken: string | null;
  dmPolicy: TelegramDmPolicy;
  /**
   * Numeric Telegram user IDs (as strings).
   * We accept prefixes like `telegram:123` / `tg:123` during write, but we store only digits.
   */
  allowFrom: string[];
  /**
   * Numeric Telegram user IDs (as strings).
   * Used when dmPolicy === "pairing".
   */
  pairedFrom: string[];
}

interface MessengerStoreData {
  // Legacy field (pre-telegramConfig.botToken migration)
  telegramBotToken?: string | null;
  telegramConfig?: Partial<TelegramMessengerConfig>;
}

@Injectable()
export class MessengerStoreService
  extends FileStoreService
  implements OnModuleInit
{
  private readonly STORE_FILE = "messenger-config.json";
  private telegramConfig: TelegramMessengerConfig = {
    botToken: null,
    dmPolicy: "pairing",
    allowFrom: [],
    pairedFrom: [],
  };

  onModuleInit(): void {
    this.loadFromFile();
  }

  private normalizeTelegramUserId(input: string): string | null {
    const trimmed = (input ?? "").trim();
    if (!trimmed) return null;

    // Accept `telegram:123` / `tg:123` (docs-style), store only digits.
    const withoutPrefix = trimmed.replace(/^(telegram|tg):/i, "");
    if (!/^\d+$/.test(withoutPrefix)) return null;
    return withoutPrefix;
  }

  private loadFromFile(): void {
    const defaultData: MessengerStoreData = {
      telegramConfig: {
        botToken: null,
        dmPolicy: "pairing",
        allowFrom: [],
        pairedFrom: [],
      },
    };

    const data = this.readFile<MessengerStoreData>(
      this.STORE_FILE,
      defaultData
    );
    const legacyToken = data.telegramBotToken ?? null;
    this.telegramConfig = {
      ...defaultData.telegramConfig!,
      ...(data.telegramConfig ?? {}),
      botToken:
        data.telegramConfig?.botToken ??
        legacyToken ??
        defaultData.telegramConfig!.botToken,
    } as TelegramMessengerConfig;
    // Backfill sanitization in case old files contain non-numeric entries.
    this.telegramConfig.allowFrom = (this.telegramConfig.allowFrom ?? [])
      .map((x) => this.normalizeTelegramUserId(x))
      .filter((x): x is string => !!x);
    this.telegramConfig.pairedFrom = (this.telegramConfig.pairedFrom ?? [])
      .map((x) => this.normalizeTelegramUserId(x))
      .filter((x): x is string => !!x);
  }

  private saveToFile(): void {
    // Canonical: token lives in `telegramConfig.botToken`.
    const data: Pick<MessengerStoreData, "telegramConfig"> = {
      telegramConfig: this.telegramConfig,
    };
    this.writeFile(this.STORE_FILE, data);
  }

  getTelegramStatus(): { hasToken: boolean } {
    return { hasToken: !!this.telegramConfig.botToken };
  }

  getTelegramBotToken(): string | null {
    return this.telegramConfig.botToken;
  }

  clearTelegramBotToken(): void {
    this.telegramConfig.botToken = null;
    this.saveToFile();
  }

  getTelegramConfig(): TelegramMessengerConfig {
    return this.telegramConfig;
  }

  setTelegramConfig(config: Partial<TelegramMessengerConfig>): void {
    const next: TelegramMessengerConfig = {
      ...this.telegramConfig,
    };

    if (config.botToken !== undefined) {
      next.botToken = config.botToken;
    }
    if (config.dmPolicy) {
      next.dmPolicy = config.dmPolicy;
    }
    if (config.allowFrom) {
      next.allowFrom = config.allowFrom
        .map((x) => this.normalizeTelegramUserId(x))
        .filter((x): x is string => !!x);
    }
    if (config.pairedFrom) {
      next.pairedFrom = config.pairedFrom
        .map((x) => this.normalizeTelegramUserId(x))
        .filter((x): x is string => !!x);
    }

    this.telegramConfig = next;
    this.saveToFile();
  }

  pairTelegramUser(fromId: string): void {
    const userId = this.normalizeTelegramUserId(fromId);
    if (!userId) return;

    if (!this.telegramConfig.pairedFrom.includes(userId)) {
      this.telegramConfig.pairedFrom = [
        ...this.telegramConfig.pairedFrom,
        userId,
      ];
      this.saveToFile();
    }
  }
}
