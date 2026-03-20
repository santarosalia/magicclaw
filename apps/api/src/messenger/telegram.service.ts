import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { Bot, Context, InputFile } from "grammy";
import { MessengerStoreService } from "../store/messenger-store.service";
import {
  CHAT_ORCHESTRATOR,
  type ChatOrchestrator,
} from "./chat-orchestrator.port";
import { TelegramPolicyService } from "./telegram-policy.service";
import { AgentChannel } from "../agent/agent.types";

@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);
  private bot: Bot<Context> | null = null;

  constructor(
    private readonly messengerStore: MessengerStoreService,
    private readonly policy: TelegramPolicyService,
    @Inject(CHAT_ORCHESTRATOR)
    private readonly chatOrchestrator: ChatOrchestrator
  ) {}

  async onModuleInit() {
    await this.startBot();
  }
  async onModuleDestroy() {
    await this.stopBot();
  }

  async startBot() {
    const token = this.messengerStore.getTelegramBotToken();
    if (!token) {
      this.logger.log(
        "Telegram bot token not set. Telegram bot will not start."
      );
      return;
    }

    try {
      const bot = new Bot<Context>(token);
      this.bot = bot;

      this.registerHandlers(bot);
      bot.start();
      this.logger.log("Telegram bot started with long polling.");
    } catch (error) {
      this.logger.error("Failed to start Telegram bot", error as Error);
      if (this.bot) {
        await this.bot.stop();
      }
      this.bot = null;
    }
  }

  async stopBot() {
    await this.bot?.stop();
    this.bot = null;
  }

  private registerHandlers(bot: Bot<Context>): void {
    bot.command("start", async (ctx: Context) => {
      this.logger.log(`start command: ${ctx.from?.id}`);
      await ctx.reply(
        "안녕하세요! MagicClaw Telegram 봇입니다.\n무엇을 도와드릴까요?"
      );
    });

    bot.on("message:text", async (ctx: Context) => {
      if (!ctx.message) return;
      if (!ctx.chatId) return;

      const text = ctx.message.text?.trim() ?? "";
      if (!text) return;
      // Command messages are handled by `bot.command(...)`.
      if (text.startsWith("/")) return;

      const fromId = ctx.from?.id;
      if (!fromId) return;

      const fromIdStr = String(fromId);
      const policy = this.policy.isAllowed(fromIdStr);
      if (!policy.allowed) {
        if (policy.shouldAutoPair) {
          this.messengerStore.pairTelegramUser(fromIdStr);
          return ctx.reply(
            "페어링이 완료되었습니다. 이제 DM 메시지를 보낼 수 있어요."
          );
        }
        return ctx.reply("권한이 없습니다.");
      }

      try {
        const firstMessage = await ctx.reply("응답을 생성하는 중입니다...");
        await ctx.replyWithChatAction("typing");
        const replyText = await this.chatOrchestrator.chat(
          String(ctx.chatId),
          text,
          AgentChannel.TELEGRAM
        );

        await ctx.api.editMessageText(
          ctx.chatId,
          firstMessage.message_id,
          replyText
        );
      } catch (error) {
        this.logger.error(
          "Error while handling Telegram message",
          error as Error
        );
        await ctx.reply(
          "서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."
        );
      }
    });
  }

  async sendDocument(chatId: string, filePath: string): Promise<void> {
    await this.bot?.api.sendDocument(String(chatId), new InputFile(filePath));
  }
}
