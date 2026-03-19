import { Body, Controller, Delete, Get, Post } from '@nestjs/common';
import { MessengerStoreService } from "../store/messenger-store.service.js";
import type { TelegramMessengerConfig } from "../store/messenger-store.service.js";

interface TelegramTokenDto {
  botToken: string;
}

interface TelegramDmConfigResponse {
  dmPolicy?: TelegramMessengerConfig["dmPolicy"];
  allowFrom?: string[];
  pairedFrom?: string[];
}

interface TelegramConfigDto {
  dmPolicy?: TelegramMessengerConfig["dmPolicy"];
  allowFrom?: string[];
}

@Controller('messenger')
export class MessengerController {
  constructor(private readonly store: MessengerStoreService) {}

  @Get('telegram/status')
  getTelegramStatus(): { hasToken: boolean } {
    return this.store.getTelegramStatus();
  }

  @Get('telegram/config')
  getTelegramConfig(): TelegramDmConfigResponse {
    const cfg = this.store.getTelegramConfig();
    return {
      dmPolicy: cfg.dmPolicy,
      allowFrom: cfg.allowFrom,
      pairedFrom: cfg.pairedFrom,
    };
  }

  @Post('telegram/token')
  setTelegramToken(@Body() body: TelegramTokenDto): { success: boolean } {
    this.store.setTelegramBotToken(body.botToken ?? '');
    return { success: true };
  }

  @Post('telegram/config')
  setTelegramConfig(@Body() body: TelegramConfigDto): { success: boolean } {
    this.store.setTelegramConfig({
      dmPolicy: body.dmPolicy,
      allowFrom: body.allowFrom,
    });
    return { success: true };
  }

  @Delete('telegram/token')
  clearTelegramToken(): { success: boolean } {
    this.store.clearTelegramBotToken();
    return { success: true };
  }
}

