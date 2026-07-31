import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";

export type ProcessStatus = "running" | "exited" | "killed";

export interface ManagedProcess {
  sessionId: string;
  command: string;
  cwd: string;
  status: ProcessStatus;
  exitCode: number | null;
  startedAt: number;
  endedAt: number | null;
  output: string;
  child: ChildProcessWithoutNullStreams;
  readOffset: number;
}

export class ProcessRegistry {
  private readonly processes = new Map<string, ManagedProcess>();

  start(command: string, cwd: string): ManagedProcess {
    const sessionId = `bg_${randomUUID().slice(0, 8)}`;
    const child = spawn(command, {
      cwd,
      shell: true,
      env: process.env,
    });

    const entry: ManagedProcess = {
      sessionId,
      command,
      cwd,
      status: "running",
      exitCode: null,
      startedAt: Date.now(),
      endedAt: null,
      output: "",
      child,
      readOffset: 0,
    };

    const append = (chunk: Buffer | string) => {
      entry.output += chunk.toString();
      if (entry.output.length > 2_000_000) {
        entry.output = entry.output.slice(-1_500_000);
        entry.readOffset = Math.min(entry.readOffset, entry.output.length);
      }
    };

    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", (err) => {
      entry.output += `\n[process error] ${err.message}`;
      entry.status = "exited";
      entry.exitCode = 1;
      entry.endedAt = Date.now();
    });
    child.on("close", (code, signal) => {
      entry.status = signal ? "killed" : "exited";
      entry.exitCode = code ?? (signal ? -1 : 0);
      entry.endedAt = Date.now();
    });

    this.processes.set(sessionId, entry);
    return entry;
  }

  list(): Array<{
    session_id: string;
    command: string;
    status: ProcessStatus;
    exit_code: number | null;
    cwd: string;
  }> {
    return [...this.processes.values()].map((p) => ({
      session_id: p.sessionId,
      command: p.command,
      status: p.status,
      exit_code: p.exitCode,
      cwd: p.cwd,
    }));
  }

  get(sessionId: string): ManagedProcess | undefined {
    return this.processes.get(sessionId);
  }

  poll(sessionId: string): Record<string, unknown> {
    const p = this.require(sessionId);
    const newOutput = p.output.slice(p.readOffset);
    p.readOffset = p.output.length;
    return {
      session_id: sessionId,
      status: p.status,
      exit_code: p.exitCode,
      output: newOutput,
    };
  }

  log(
    sessionId: string,
    offset?: number,
    limit = 200
  ): Record<string, unknown> {
    const p = this.require(sessionId);
    const lines = p.output.split("\n");
    const start =
      offset === undefined
        ? Math.max(0, lines.length - limit)
        : Math.max(0, offset);
    const slice = lines.slice(start, start + limit);
    return {
      session_id: sessionId,
      status: p.status,
      exit_code: p.exitCode,
      offset: start,
      lines: slice,
      total_lines: lines.length,
    };
  }

  async wait(
    sessionId: string,
    timeoutSec = 60
  ): Promise<Record<string, unknown>> {
    const p = this.require(sessionId);
    if (p.status !== "running") {
      return this.poll(sessionId);
    }

    const deadline = Date.now() + timeoutSec * 1000;
    while (Date.now() < deadline) {
      if (p.status !== "running") break;
      await new Promise((r) => setTimeout(r, 100));
    }
    return this.poll(sessionId);
  }

  kill(sessionId: string): Record<string, unknown> {
    const p = this.require(sessionId);
    if (p.status === "running") {
      p.child.kill("SIGTERM");
      p.status = "killed";
      p.endedAt = Date.now();
    }
    return {
      session_id: sessionId,
      status: p.status,
      exit_code: p.exitCode,
    };
  }

  write(sessionId: string, data: string, submit: boolean): Record<string, unknown> {
    const p = this.require(sessionId);
    if (p.status !== "running") {
      return { error: "process is not running", session_id: sessionId };
    }
    const payload = submit ? `${data}\n` : data;
    p.child.stdin.write(payload);
    return { session_id: sessionId, written: payload.length };
  }

  closeStdin(sessionId: string): Record<string, unknown> {
    const p = this.require(sessionId);
    p.child.stdin.end();
    return { session_id: sessionId, closed: true };
  }

  private require(sessionId: string): ManagedProcess {
    const p = this.processes.get(sessionId);
    if (!p) {
      throw new Error(`Unknown process session_id: ${sessionId}`);
    }
    return p;
  }
}

/** Shared process registry for the API process lifetime. */
export const processRegistry = new ProcessRegistry();
