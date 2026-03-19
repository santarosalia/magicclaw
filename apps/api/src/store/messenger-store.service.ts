import { Injectable, OnModuleInit } from "@nestjs/common";
import { FileStoreService } from "../common/file-store.service.js";

interface MessengerStoreData {
  telegramBotToken: string | null;
}

@Injectable()
export class MessengerStoreService
  extends FileStoreService
  implements OnModuleInit
{
  private readonly STORE_FILE = "messenger-config.json";
  private telegramBotToken: string | null = null;

  onModuleInit(): void {
    this.loadFromFile();
  }

  private loadFromFile(): void {
    const data = this.readFile<MessengerStoreData>(this.STORE_FILE, {
      telegramBotToken: null,
    });
    this.telegramBotToken = data.telegramBotToken ?? null;
  }

  private saveToFile(): void {
    const data: MessengerStoreData = {
      telegramBotToken: this.telegramBotToken,
    };
    this.writeFile(this.STORE_FILE, data);
  }

  getTelegramStatus(): { hasToken: boolean } {
    return { hasToken: !!this.telegramBotToken };
  }

  getTelegramBotToken(): string | null {
    return this.telegramBotToken;
  }

  setTelegramBotToken(token: string): void {
    this.telegramBotToken = token || null;
    this.saveToFile();
  }

  clearTelegramBotToken(): void {
    this.telegramBotToken = null;
    this.saveToFile();
  }
}

