import { Module } from "@nestjs/common";
import { MessengerController } from "./messenger.controller.js";
import { TelegramService } from "./telegram.service.js";
import { StoreModule } from "../store/store.module.js";
import { AgentModule } from "../agent/agent.module.js";
import { TelegramPolicyService } from "./telegram-policy.service.js";

@Module({
  imports: [StoreModule, AgentModule],
  controllers: [MessengerController],
  providers: [TelegramService, TelegramPolicyService],
  exports: [TelegramService],
})
export class MessengerModule {}
