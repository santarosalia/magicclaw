import { Module } from "@nestjs/common";
import { MessengerController } from "./messenger.controller.js";
import { TelegramService } from "./telegram.service.js";
import { SessionService } from "../agent/session.service.js";
import { StoreModule } from "../store/store.module.js";

@Module({
  imports: [StoreModule],
  controllers: [MessengerController],
  providers: [TelegramService, SessionService],
  exports: [TelegramService],
})
export class MessengerModule {}
