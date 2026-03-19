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

  constructor(
    private readonly messengerStore: MessengerStoreService,
    private readonly session: SessionService,
    private readonly moduleRef: ModuleRef
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
      const bot = new Bot<Context>(token);
      this.bot = bot;

      this.registerHandlers(bot);
      bot.start();
      this.logger.log("Telegram bot started with long polling.");
    } catch (error) {
      this.logger.error("Failed to start Telegram bot", error as Error);
      this.bot = null;
    }
  }
  async onModuleDestroy() {
    await this.bot?.stop();
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

      const history = this.session.get(String(ctx.chatId));
      const text = ctx.message.text?.trim() ?? "";
      if (!text) return;
      // Command messages are handled by `bot.command(...)`.
      if (text.startsWith("/")) return;

      const fromId = ctx.from?.id;
      if (!fromId) return;

      const fromIdStr = String(fromId);
      const cfg = this.messengerStore.getTelegramConfig();

      // 접근제어: openclaw 문서의 dmPolicy를 현재 프로젝트에서는 모든 채팅 메시지에 간단화해서 적용합니다.
      // - pairing: pairedFrom에 있으면 허용. pairedFrom이 비어있으면 첫 사용자 자동 페어링.
      // - allowlist: allowFrom에 있으면 허용(비어있으면 전부 차단).
      // - open: 전부 허용
      // - disabled: 전부 차단
      switch (cfg.dmPolicy) {
        case "disabled":
          return await ctx.reply("권한이 없습니다.");
        case "open":
          break;
        case "allowlist":
          if (!cfg.allowFrom.includes(fromIdStr))
            return await ctx.reply("권한이 없습니다.");
          break;
        case "pairing":
          if (!cfg.pairedFrom.includes(fromIdStr)) {
            if ((cfg.pairedFrom ?? []).length === 0) {
              // 초기 설정 편의: 첫 사용자를 자동 페어링.
              this.messengerStore.pairTelegramUser(fromIdStr);
              return ctx.reply(
                "페어링이 완료되었습니다. 이제 DM 메시지를 보낼 수 있어요."
              );
            } else {
              return ctx.reply("권한이 없습니다.");
            }
          }
          break;
      }

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
    await this.bot?.api.sendDocument(String(chatId), new InputFile(filePath));
  }
}
