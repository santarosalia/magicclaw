import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { Bot, Context, InputFile } from "grammy";
import { HumanMessage } from "langchain";
import { MessengerStoreService } from "../store/messenger-store.service.js";
import { SessionService } from "../agent/session.service.js";
import type { AgentService } from "../agent/agent.service.js";

@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);
  private bot: Bot<Context> | null = null;
  private agentService: AgentService | null = null;

  private readonly botReadyPromise: Promise<Bot<Context>>;
  private botReadyResolver: ((bot: Bot<Context>) => void) | null = null;

  constructor(
    private readonly messengerStore: MessengerStoreService,
    private readonly session: SessionService,
    private readonly moduleRef: ModuleRef
  ) {
    this.botReadyPromise = new Promise<Bot<Context>>((resolve) => {
      this.botReadyResolver = resolve;
    });
  }

  async onModuleInit(): Promise<void> {
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
      this.botReadyResolver?.(bot);
      this.botReadyResolver = null;

      this.registerHandlers(bot);
      bot.start();
      this.logger.log("Telegram bot started with long polling.");
    } catch (error) {
      this.logger.error("Failed to start Telegram bot", error as Error);
      this.bot = null;
    }
  }
  onModuleDestroy(): void {
    this.bot?.stop();
  }

  private async getBotWithTimeout(ms: number): Promise<Bot<Context>> {
    if (this.bot) return this.bot;

    const timeout = new Promise<Bot<Context>>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Telegram bot not initialized within ${ms}ms`));
      }, ms);
    });

    return Promise.race([this.botReadyPromise, timeout]);
  }

  private registerHandlers(bot: Bot<Context>): void {
    bot.command("start", async (ctx: Context) => {
      this.logger.log(`start command: ${ctx.from?.id}`);
      await ctx.reply(
        "안녕하세요! MagicClaw Telegram 봇입니다.\n무엇을 도와드릴까요?"
      );
    });

    bot.on("message:text", async (ctx: Context) => {
      if (ctx.from?.id !== 8714125059) return;
      if (!ctx.message) return;
      if (!ctx.chatId) return;

      const history = this.session.get(String(ctx.chatId));
      const text = ctx.message.text?.trim() ?? "";
      if (!text) return;

      try {
        if (!this.agentService) {
          // Nest 초기화 도중엔 AgentService 생성이 너무 빨리 발생할 수 있으므로,
          // 실제 메시지 처리 시점에 처음 조회합니다.
          const mod = await import("../agent/agent.service.js");
          this.agentService = this.moduleRef.get(mod.AgentService, {
            strict: false,
          }) as AgentService | null;
        }
        if (!this.agentService) throw new Error("AgentService not found");

        const userMsg = new HumanMessage({ content: text });
        const messagesLc = [...history, userMsg];

        await ctx.replyWithChatAction("typing");
        const messagesLcResult = await this.agentService.chat({
          messagesLc,
          sessionId: String(ctx.chatId),
        });

        const last = messagesLcResult.at(-1);
        const content = typeof last?.content === "string" ? last.content : "";
        const replyText = content || "응답을 생성하지 못했습니다.";

        await ctx.reply(replyText);

        const newMessages = messagesLcResult.slice(messagesLc.length - 1);
        this.session.append(String(ctx.chatId), ...newMessages);
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
    const bot = await this.getBotWithTimeout(10_000);

    await bot.api.sendDocument(String(chatId), new InputFile(filePath));
  }
}
