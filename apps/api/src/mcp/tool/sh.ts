import { exec } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";

const execAsync = promisify(exec);

export const shTool = new DynamicStructuredTool({
  name: "sh",
  description:
    "서버에서 쉘 명령어를 실행하고 결과(stdout/stderr)를 반환하는 도구입니다. 매우 신중하게 사용하세요.",
  schema: z.object({
    command: z
      .string()
      .min(1, "실행할 쉘 명령어를 입력해야 합니다.")
      .describe("실행할 전체 쉘 명령어 문자열"),
    cwd: z
      .string()
      .optional()
      .describe(
        "옵션: 명령을 실행할 작업 디렉터리(기본값: 현재 프로세스 디렉터리)"
      ),
    timeoutMs: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("옵션: 명령 실행 최대 시간(ms). 기본 60000ms"),
  }),

  func: async ({ command, cwd, timeoutMs }) => {
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: cwd || process.cwd(),
        timeout: timeoutMs ?? 60_000,
        maxBuffer: 10 * 1024 * 1024, // 10MB
      });

      const parts: string[] = [];
      if (stdout && stdout.trim().length > 0) {
        parts.push(`STDOUT:\n${stdout}`);
      }
      if (stderr && stderr.trim().length > 0) {
        parts.push(`STDERR:\n${stderr}`);
      }

      if (parts.length === 0) {
        return "명령이 성공적으로 실행되었지만 출력이 없습니다.";
      }

      return parts.join("\n\n");
    } catch (err: unknown) {
      const e = err as
        | (Error & { code?: number | string; stdout?: string; stderr?: string })
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

export type ShTool = typeof shTool;
