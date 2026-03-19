import { Body, Controller, Delete, Get, Post } from '@nestjs/common';
import { MessengerStoreService } from "../store/messenger-store.service.js";

interface TelegramTokenDto {
  botToken: string;
}

@Controller('messenger')
export class MessengerController {
  constructor(private readonly store: MessengerStoreService) {}

  @Get('telegram/status')
  getTelegramStatus(): { hasToken: boolean } {
    return this.store.getTelegramStatus();
  }

  @Post('telegram/token')
  setTelegramToken(@Body() body: TelegramTokenDto): { success: boolean } {
    this.store.setTelegramBotToken(body.botToken ?? '');
    return { success: true };
  }

  @Delete('telegram/token')
  clearTelegramToken(): { success: boolean } {
    this.store.clearTelegramBotToken();
    return { success: true };
  }
}

