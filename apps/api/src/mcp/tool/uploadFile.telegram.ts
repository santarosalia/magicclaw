import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { TelegramService } from "../../messenger/telegram.service.js";

export function createUploadFileTelegramTool(telegramService: TelegramService) {
  return new DynamicStructuredTool({
    name: "uploadFileTelegram",
    description: "Telegram에 파일을 업로드하는 도구입니다.",
    schema: z.object({
      path: z
        .string()
        .min(1, "파일 경로를 입력해야 합니다.")
        .describe("파일 경로"),
      chatId: z
        .string()
        .min(1, "채팅 ID를 입력해야 합니다.")
        .describe("채팅 ID"),
    }),

    func: async ({ path, chatId }) => {
      try {
        await telegramService.sendDocument(chatId, path);
      } catch (err: unknown) {
        const e = err as
          | (Error & {
              code?: number | string;
              stdout?: string;
              stderr?: string;
            })
          | undefined;

        const parts: string[] = [];
        parts.push(
          `명령 실행 실패${
            e?.code !== undefined ? ` (코드: ${String(e.code)})` : ""
          }.`
        );

        if (e?.stdout && e.stdout.trim().length > 0) {
          parts.push(`STDOUT:\n${e.stdout}`);
        }
        if (e?.stderr && e.stderr.trim().length > 0) {
          parts.push(`STDERR:\n${e.stderr}`);
        }
        if (parts.length === 1) {
          parts.push(
            `에러: ${
              e instanceof Error ? e.message : JSON.stringify(err, null, 2)
            }`
          );
        }

        return parts.join("\n\n");
      }
    },
  });
}
