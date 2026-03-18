import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Bot, Context, InputFile } from "grammy";
import { MessengerStoreService } from "./messenger-store.service.js";
import { AgentService } from "../agent/agent.service.js";
import { HumanMessage } from "langchain";
import { SessionService } from "../agent/session.service.js";

@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name);
  private bot: Bot<Context> | null = null;

  constructor(
    private readonly messengerStore: MessengerStoreService,
    private readonly agentService: AgentService,
    private readonly session: SessionService
  ) {}

  async onModuleInit(): Promise<void> {
    const token = this.messengerStore.getTelegramBotToken();
    if (!token) {
      this.logger.log(
        "Telegram bot token not set. Telegram bot will not start."
      );
      return;
    }

    try {
      this.bot = new Bot<Context>(token);
      this.registerHandlers(this.bot);
      this.bot.start();
      this.logger.log("Telegram bot started with long polling.");
    } catch (error) {
      this.logger.error("Failed to start Telegram bot", error as Error);
      this.bot = null;
    }
  }

  private registerHandlers(bot: Bot<Context>): void {
    bot.command("start", async (ctx: Context) => {
      await ctx.reply(
        "안녕하세요! MagicClaw Telegram 봇입니다.\n무엇을 도와드릴까요?"
      );
    });

    bot.on("message:text", async (ctx: Context) => {
      if (!ctx.message) return;
      if (!ctx.chatId) return;

      const history = this.session.get(String(ctx.chatId));
      const text = ctx.message.text?.trim() ?? "";

      if (!text) return;

      try {
        const userMsg = new HumanMessage({ content: text });
        const messagesLc = [...history, userMsg];

        await ctx.replyWithChatAction("typing");
        const messagesLcResult = await this.agentService.chat({
          messagesLc,
        });
        const last = messagesLcResult.at(-1);
        const content = typeof last?.content === "string" ? last.content : "";
        const replyText = content || "응답을 생성하지 못했습니다.";

        await ctx.reply(replyText, { parse_mode: "Markdown" });

        const newMessages = messagesLcResult.slice(messagesLc.length - 1);
        this.session.append(String(ctx.chatId), ...newMessages);

        // await ctx.replyWithDocument(
        //   new InputFile(
        //     "/Users/dope/.magicclaw/workspace/ISMSP_인증기준_102개.xlsx"
        //   )
        // );
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
}
