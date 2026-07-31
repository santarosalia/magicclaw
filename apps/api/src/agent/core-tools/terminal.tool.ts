import { exec } from "node:child_process";
import { promisify } from "node:util";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { findHardlineViolation } from "./hardline.js";
import { processRegistry } from "./process-registry.js";
import { ensureWorkspaceRoot, resolveToolPath } from "./workspace.js";

const execAsync = promisify(exec);
const FOREGROUND_DEFAULT_TIMEOUT_SEC = 180;
const FOREGROUND_MAX_TIMEOUT_SEC = 600;

const TERMINAL_DESCRIPTION = `Execute shell commands. Filesystem and cwd persist between calls via workdir.

Do NOT use cat/head/tail to read files — use read_file instead.
Do NOT use grep/rg/find to search — use search_files instead.
Do NOT use ls to list directories — use search_files(target='files') instead.
Do NOT use sed/awk to edit files — use patch instead.
Do NOT use echo/cat heredoc to create files — use write_file instead.
Reserve terminal for: builds, installs, git, processes, scripts, network, package managers.

Foreground (default): returns when done. Prefer for short commands.
Background: set background=true to get a session_id; manage with the process tool.`;

export function createTerminalTool(workspaceRoot: string): DynamicStructuredTool {
  const root = ensureWorkspaceRoot(workspaceRoot);

  return new DynamicStructuredTool({
    name: "terminal",
    description: TERMINAL_DESCRIPTION,
    schema: z.object({
      command: z.string().min(1).describe("The command to execute"),
      background: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "Run in background and return session_id for the process tool"
        ),
      timeout: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          `Max seconds to wait (default ${FOREGROUND_DEFAULT_TIMEOUT_SEC}, max ${FOREGROUND_MAX_TIMEOUT_SEC} for foreground)`
        ),
      workdir: z
        .string()
        .optional()
        .describe("Working directory (absolute or relative to workspace)"),
    }),
    func: async ({ command, background, timeout, workdir }) => {
      const blocked = findHardlineViolation(command);
      if (blocked) {
        return JSON.stringify({ success: false, error: blocked });
      }

      const cwd = workdir ? resolveToolPath(workdir, root) : root;

      if (background) {
        const entry = processRegistry.start(command, cwd);
        return JSON.stringify({
          success: true,
          status: "running",
          session_id: entry.sessionId,
          cwd,
          message:
            "Background process started. Use process(action='poll'|'wait'|'log'|'kill') with this session_id.",
        });
      }

      const timeoutSec = Math.min(
        timeout ?? FOREGROUND_DEFAULT_TIMEOUT_SEC,
        FOREGROUND_MAX_TIMEOUT_SEC
      );

      try {
        const { stdout, stderr } = await execAsync(command, {
          cwd,
          timeout: timeoutSec * 1000,
          maxBuffer: 10 * 1024 * 1024,
          env: process.env,
        });
        return JSON.stringify({
          success: true,
          exit_code: 0,
          cwd,
          output: [stdout, stderr].filter(Boolean).join("\n"),
        });
      } catch (err: unknown) {
        const e = err as {
          code?: number | string;
          stdout?: string;
          stderr?: string;
          message?: string;
          killed?: boolean;
        };
        return JSON.stringify({
          success: false,
          exit_code: typeof e.code === "number" ? e.code : 1,
          cwd,
          timed_out: Boolean(e.killed),
          output: [e.stdout, e.stderr, e.message].filter(Boolean).join("\n"),
        });
      }
    },
  });
}
