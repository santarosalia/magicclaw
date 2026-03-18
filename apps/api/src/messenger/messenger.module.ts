import { Module } from "@nestjs/common";
import { MessengerController } from "./messenger.controller.js";
import { MessengerStoreService } from "./messenger-store.service.js";
import { TelegramService } from "./telegram.service.js";
import { AgentModule } from "../agent/agent.module.js";
import { SessionService } from "../agent/session.service.js";

@Module({
  imports: [AgentModule],
  controllers: [MessengerController],
  providers: [MessengerStoreService, TelegramService, SessionService],
  exports: [MessengerStoreService, TelegramService],
})
export class MessengerModule {}
