import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";

export interface ProcessRequest {
  command: string;
  args?: string[];
  cwd: string;
  timeoutMs: number;
  logFile?: string;
  /** Only for the user's own verify command; agent CLIs are always spawned without a shell. */
  shell?: boolean;
  env?: NodeJS.ProcessEnv;
}

export interface ProcessResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  /** stdout and stderr interleaved in arrival order. */
  combined: string;
  timedOut: boolean;
  spawnError: string | null;
  durationMs: number;
}

const KILL_GRACE_MS = 2000;
const MAX_CAPTURE = 4 * 1024 * 1024;

const active = new Set<number>();

export function killAllActive(): void {
  for (const pid of active) killGroup(pid, "SIGKILL");
}

function killGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // already gone
    }
  }
}

export function runProcess(req: ProcessRequest): Promise<ProcessResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    const log = req.logFile ? createWriteStream(req.logFile, { flags: "a" }) : null;
    log?.write(`$ ${req.shell ? req.command : [req.command, ...(req.args ?? []).map(quoteForLog)].join(" ")}\n# cwd: ${req.cwd}\n`);
    let stdout = "";
    let stderr = "";
    let combined = "";
    let timedOut = false;
    let spawnError: string | null = null;
    let settled = false;

    const child = req.shell
      ? spawn(req.command, { cwd: req.cwd, shell: true, detached: true, stdio: ["ignore", "pipe", "pipe"], env: req.env ?? process.env })
      : spawn(req.command, req.args ?? [], { cwd: req.cwd, detached: true, stdio: ["ignore", "pipe", "pipe"], env: req.env ?? process.env });
    if (child.pid !== undefined) active.add(child.pid);

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      if (stdout.length < MAX_CAPTURE) stdout += chunk;
      if (combined.length < MAX_CAPTURE) combined += chunk;
      log?.write(chunk);
    });
    child.stderr?.on("data", (chunk: string) => {
      if (stderr.length < MAX_CAPTURE) stderr += chunk;
      if (combined.length < MAX_CAPTURE) combined += chunk;
      log?.write(chunk);
    });

    let killTimer: NodeJS.Timeout | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid === undefined) return;
      killGroup(child.pid, "SIGTERM");
      killTimer = setTimeout(() => child.pid !== undefined && killGroup(child.pid, "SIGKILL"), KILL_GRACE_MS);
    }, req.timeoutMs);

    const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      if (child.pid !== undefined) {
        // Reap anything the tool left behind in its process group.
        killGroup(child.pid, "SIGKILL");
        active.delete(child.pid);
      }
      const durationMs = Date.now() - started;
      const trailer = `\n# exit=${exitCode} signal=${signal} timedOut=${timedOut} durationMs=${durationMs}${spawnError ? ` spawnError=${spawnError}` : ""}\n`;
      const result = { exitCode, signal, stdout, stderr, combined, timedOut, spawnError, durationMs };
      if (log) log.end(trailer, () => resolve(result));
      else resolve(result);
    };

    child.on("error", (error) => {
      spawnError = error.message;
      finish(null, null);
    });
    // Grandchildren holding our pipes would otherwise delay "close" forever.
    child.on("exit", () => child.pid !== undefined && killGroup(child.pid, "SIGKILL"));
    child.on("close", (code, signal) => finish(code, signal));
  });
}

function quoteForLog(arg: string): string {
  const shown = arg.length > 200 ? `${arg.slice(0, 200)}…[${arg.length} chars]` : arg;
  return /^[\w@%+=:,./-]+$/.test(shown) ? shown : `'${shown.replace(/'/g, "'\\''")}'`;
}

export function tail(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `…[truncated ${text.length - maxChars} chars]\n${text.slice(-maxChars)}`;
}
