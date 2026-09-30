import { randomBytes } from "node:crypto";
import { access, constants, mkdir, readFile, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { claudeCodeAdapter } from "../adapters/claude-code/index.js";
import { codexAdapter } from "../adapters/codex/index.js";
import { CLI_DEFAULT_MODEL } from "../adapters/types.js";
import type { ProgressEvent } from "../schemas/progress.js";
import type { AgentStep, Finding, ReviewOutcome, RunReport, RunStatus, Vendor, VerifyOutcome } from "../schemas/run.js";
import { RuntimeProgress } from "./events.js";
import { addWorktree, dirtyPaths, ensureFusionExcluded, FusionError, headRevision, linkNodeModules, repoRoot, worktreeDiff } from "./git.js";
import { runProcess, tail } from "./process.js";
import { renderReportMarkdown } from "./render.js";
import { parseReview, repairPrompt, reviewPrompt, writerPrompt } from "./review.js";
import { appendLedger, runDir, writeReport } from "./runs.js";

export interface RunOptions {
  cwd: string;
  task: string;
  /** undefined = auto-detect, null = explicitly none */
  verify?: string | null;
  writer: Vendor;
  reviewer: Vendor | "none";
  repairs: number;
  writerModel?: string;
  reviewerModel?: string;
  timeoutSeconds: number;
  bins?: Partial<Record<Vendor, string>>;
  env?: NodeJS.ProcessEnv;
  heartbeatMs?: number;
}

export interface RunIO {
  status(line: string): void;
  warn(line: string): void;
}

export interface RunResult {
  report: RunReport;
  runDir: string;
  root: string;
}

const BIN_ENV: Record<Vendor, string> = { claude: "FUSION_CLAUDE_BIN", codex: "FUSION_CODEX_BIN" };
const DEFAULT_BIN: Record<Vendor, string> = { claude: "claude", codex: "codex" };

export function otherVendor(v: Vendor): Vendor {
  return v === "claude" ? "codex" : "claude";
}

export function newRunId(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}-${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`;
  return `${stamp}-${randomBytes(2).toString("hex")}`;
}

export async function detectVerifyCommand(root: string): Promise<string | null> {
  const text = await readFile(join(root, "package.json"), "utf8").catch(() => null);
  if (text === null) return null;
  try {
    const test = (JSON.parse(text) as { scripts?: Record<string, unknown> }).scripts?.test;
    if (typeof test !== "string" || test.trim() === "" || /no test specified/.test(test)) return null;
    return "npm test";
  } catch {
    return null;
  }
}

export function binFor(vendor: Vendor, options: Pick<RunOptions, "bins" | "env">): string {
  return options.bins?.[vendor] ?? (options.env ?? process.env)[BIN_ENV[vendor]] ?? DEFAULT_BIN[vendor];
}

const EXTRA_ARGS_ENV: Record<Vendor, string> = { claude: "FUSION_CLAUDE_EXTRA_ARGS", codex: "FUSION_CODEX_EXTRA_ARGS" };

/** Extra CLI flags (whitespace-separated, no shell) for e.g. `-c model_provider="openai"` or `--profile work`. */
export function withExtraArgs(vendor: Vendor, args: string[], env: NodeJS.ProcessEnv): string[] {
  const extra = (env[EXTRA_ARGS_ENV[vendor]] ?? "").split(/\s+/).filter(Boolean);
  if (extra.length === 0) return args;
  const promptSeparator = args.indexOf("--");
  if (vendor === "codex" && promptSeparator >= 0) return [...args.slice(0, promptSeparator), ...extra, ...args.slice(promptSeparator)];
  return [...args, ...extra];
}

async function assertExecutable(bin: string, env: NodeJS.ProcessEnv, vendor: Vendor): Promise<void> {
  const candidates = bin.includes("/") ? [bin] : (env.PATH ?? "").split(delimiter).filter(Boolean).map((d) => join(d, bin));
  for (const c of candidates) {
    if (await access(c, constants.X_OK).then(() => true, () => false)) return;
  }
  throw new FusionError(`${vendor} CLI not found: "${bin}". Install it and log in, or point ${BIN_ENV[vendor]} at the executable.`);
}

export async function prepareRun(options: RunOptions): Promise<{ root: string; verifyCommand: string | null; verifySource: RunReport["verifySource"]; dirty: string[] }> {
  if (!options.task.trim()) throw new FusionError("task must not be empty");
  if (!Number.isInteger(options.repairs) || options.repairs < 0 || options.repairs > 2) throw new FusionError("--repairs must be 0, 1, or 2");
  if (!Number.isFinite(options.timeoutSeconds) || options.timeoutSeconds <= 0) throw new FusionError("--timeout must be a positive number of seconds");
  const root = await repoRoot(options.cwd);
  await headRevision(root);
  const env = options.env ?? process.env;
  await assertExecutable(binFor(options.writer, options), env, options.writer);
  if (options.reviewer !== "none") await assertExecutable(binFor(options.reviewer, options), env, options.reviewer);
  let verifyCommand: string | null;
  let verifySource: RunReport["verifySource"];
  if (options.verify === undefined) {
    verifyCommand = await detectVerifyCommand(root);
    verifySource = verifyCommand ? "auto-detected" : "none";
  } else {
    verifyCommand = options.verify && options.verify.trim() ? options.verify : null;
    verifySource = verifyCommand ? "flag" : "none";
  }
  return { root, verifyCommand, verifySource, dirty: await dirtyPaths(root) };
}

export async function runFusion(options: RunOptions, io: RunIO): Promise<RunResult> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const { root, verifyCommand, verifySource, dirty } = await prepareRun(options);
  const base = await headRevision(root);
  const env = options.env ?? process.env;
  const timeoutMs = Math.round(options.timeoutSeconds * 1000);
  const warnings: string[] = [];
  const warn = (msg: string) => {
    warnings.push(msg);
    io.warn(msg);
  };

  const id = newRunId();
  const dir = runDir(root, id);
  const work = join(dir, "work");
  const logs = join(dir, "logs");
  await ensureFusionExcluded(root);
  await mkdir(logs, { recursive: true });

  if (dirty.length > 0) {
    warn(`your working tree has ${dirty.length} uncommitted change(s); they are NOT included. Fusion works from HEAD ${base.slice(0, 10)}.`);
  }
  if (!verifyCommand) {
    warn("NO VERIFY GATE: no --verify given and no package.json test script found. The patch will only be reviewed, not tested.");
  } else if (verifySource === "auto-detected") {
    io.status(`verify command auto-detected: ${verifyCommand}`);
  }

  await addWorktree(root, work, base);
  if (await linkNodeModules(root, work)) io.status("linked your node_modules into the worktree (read-through, excluded from the patch)");

  const elapsed = () => {
    const s = Math.floor((Date.now() - started) / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  const progress = new RuntimeProgress(id, (e: ProgressEvent) => {
    if (e.state === "planned" || e.state === "ready") return;
    io.status(`[${elapsed()}] ${e.legId} ${e.state.padEnd(9)} ${e.reason.message}`);
  });

  const steps: AgentStep[] = [];
  const verifications: VerifyOutcome[] = [];
  const reviews: ReviewOutcome[] = [];
  const writerModel = options.writerModel ?? null;
  const reviewerModel = options.reviewer === "none" ? null : (options.reviewerModel ?? null);
  let stepCounter = 0;

  const withHeartbeat = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
    const legStart = Date.now();
    const timer = setInterval(() => io.status(`[${elapsed()}] … ${label} still running (${Math.round((Date.now() - legStart) / 1000)}s)`), options.heartbeatMs ?? 15000);
    timer.unref();
    try {
      return await fn();
    } finally {
      clearInterval(timer);
    }
  };

  const invokeAgent = async (kind: AgentStep["kind"], vendor: Vendor, model: string | null, prompt: string): Promise<{ step: AgentStep; text: string }> => {
    const readOnly = kind === "review";
    const adapter = vendor === "claude" ? claudeCodeAdapter : codexAdapter;
    const plan = adapter.planInvocation({
      binding: { adapter: vendor === "claude" ? "claude-code" : "codex", model: model ?? CLI_DEFAULT_MODEL },
      instruction: prompt,
      cwd: work,
      readOnly,
      timeoutSeconds: Math.max(1, Math.round(options.timeoutSeconds)),
    });
    const logName = `${String(++stepCounter).padStart(2, "0")}-${kind}-${vendor}.log`;
    const label = `${kind === "review" ? "reviewer" : "writer"} ${vendor}${model ? ` (${model})` : ""}`;
    const legId = progress.startLeg(`${label}: ${kind}${readOnly ? " (read-only)" : ""}`);
    const res = await withHeartbeat(label, () =>
      runProcess({ command: binFor(vendor, options), args: withExtraArgs(vendor, plan.args, env), cwd: work, timeoutMs, logFile: join(logs, logName), env }),
    );
    const envelope = adapter.parseOutput(res.stdout, res.exitCode);
    let outcome: string = envelope.outcome;
    let summary = envelope.summary;
    if (res.timedOut) {
      outcome = "timed-out";
      summary = `killed after ${options.timeoutSeconds}s timeout`;
    } else if (res.spawnError) {
      outcome = "failed";
      summary = `could not start ${binFor(vendor, options)}: ${res.spawnError}`;
    } else if (res.exitCode !== 0 && outcome === "succeeded") {
      outcome = "failed";
    }
    if (outcome !== "succeeded" && !res.timedOut && !res.spawnError && (envelope.outcome === "malformed-output" || envelope.outcome === "schema-drift") && res.stderr.trim()) {
      summary = `${summary}; stderr: ${tail(res.stderr.trim(), 600)}`;
    }
    const step: AgentStep = {
      kind,
      vendor,
      model: envelope.model ?? model,
      outcome,
      exitCode: res.exitCode,
      durationMs: res.durationMs,
      summary: tail(summary, 4000),
      costUsd: envelope.usage.status === "reported" ? (envelope.usage.costUsd ?? null) : null,
      log: `logs/${logName}`,
    };
    steps.push(step);
    const state = outcome === "succeeded" ? "succeeded" : outcome === "timed-out" ? "timed-out" : outcome === "malformed-output" ? "malformed-output" : outcome === "schema-drift" ? "schema-drift" : outcome === "budget-exhausted" ? "budget-exhausted" : "failed";
    progress.endLeg(legId, state, `agent-${state}`, `${label} ${outcome} in ${Math.round(res.durationMs / 1000)}s`, step.log);
    return { step, text: envelope.summary };
  };

  const runVerify = async (): Promise<VerifyOutcome> => {
    const logName = `${String(++stepCounter).padStart(2, "0")}-verify.log`;
    const legId = progress.startLeg(`verify: ${verifyCommand}`);
    const res = await withHeartbeat("verify", () => runProcess({ command: verifyCommand!, shell: true, cwd: work, timeoutMs, logFile: join(logs, logName), env }));
    const passed = res.exitCode === 0 && !res.timedOut && !res.spawnError;
    const v: VerifyOutcome = {
      command: verifyCommand!,
      passed,
      exitCode: res.exitCode,
      timedOut: res.timedOut,
      durationMs: res.durationMs,
      outputTail: tail(res.combined, 8000),
    };
    verifications.push(v);
    progress.endLeg(legId, passed ? "succeeded" : res.timedOut ? "timed-out" : "failed", passed ? "verify-passed" : "verify-failed", `verify ${passed ? "PASS" : "FAIL"} (exit ${res.exitCode ?? "none"})`, `logs/${logName}`);
    return v;
  };

  const runReview = async (reviewer: Vendor, diff: string, verify: VerifyOutcome | null): Promise<ReviewOutcome> => {
    const { step, text } = await invokeAgent("review", reviewer, reviewerModel, reviewPrompt(options.task, diff, verify));
    const outcome: ReviewOutcome =
      step.outcome === "succeeded" ? parseReview(text) : { status: "unavailable", reason: `reviewer ${step.outcome}: ${tail(step.summary, 300)}` };
    reviews.push(outcome);
    io.status(
      outcome.status === "ok"
        ? `[${elapsed()}] review: ${outcome.verdict.toUpperCase()} (${outcome.blocking.length} blocking, ${outcome.suggestions.length} suggestion(s))`
        : `[${elapsed()}] review UNAVAILABLE: ${outcome.reason}`,
    );
    return outcome;
  };

  let status: RunStatus;
  let repairsUsed = 0;
  const { step: first } = await invokeAgent("write", options.writer, writerModel, writerPrompt(options.task, verifyCommand));
  const ignoredToolFiles = new Set<string>();
  const collectDiff = async () => {
    const d = await worktreeDiff(work, base);
    for (const f of d.ignoredToolFiles) ignoredToolFiles.add(f);
    return d;
  };
  let diff = await collectDiff();

  if (first.outcome !== "succeeded") {
    status = "writer-failed";
    warn(`writer ${options.writer} ${first.outcome}: ${tail(first.summary, 400)}`);
  } else if (diff.files.length === 0) {
    status = "no-changes";
    warn("the writer finished without changing any files; skipping verify and review");
  } else {
    let repairFailed = false;
    for (;;) {
      const verify = verifyCommand ? await runVerify() : null;
      const canRepair = repairsUsed < options.repairs;
      let review: ReviewOutcome | null = null;
      if (options.reviewer !== "none") {
        if (verify && !verify.passed && canRepair) io.status(`[${elapsed()}] review deferred: verify failed and a repair is available`);
        else review = await runReview(options.reviewer, diff.patch, verify);
      }
      const blocking: Finding[] = review?.status === "ok" ? review.blocking : [];
      const needsRepair = (verify !== null && !verify.passed) || blocking.length > 0;
      if (!needsRepair || !canRepair) break;
      repairsUsed++;
      const { step: repair } = await invokeAgent("repair", options.writer, writerModel, repairPrompt(options.task, verifyCommand, verify, blocking));
      diff = await collectDiff();
      if (repair.outcome !== "succeeded") {
        repairFailed = true;
        warn(`repair attempt ${repairsUsed} ${repair.outcome}; the patch may contain partial repair edits that were not re-verified`);
        break;
      }
      if (diff.files.length === 0) {
        warn("the repair removed every change; nothing left to verify");
        break;
      }
    }
    const lastVerify = verifications.at(-1);
    const lastReview = reviews.at(-1);
    const verifyOk = !verifyCommand || lastVerify?.passed === true;
    const reviewOk = options.reviewer === "none" || (lastReview?.status === "ok" && lastReview.verdict === "approve");
    status = diff.files.length === 0 ? "no-changes" : verifyOk && reviewOk && !repairFailed ? "ready" : "needs-attention";
  }

  if (ignoredToolFiles.size > 0) {
    warn(`left ${ignoredToolFiles.size} new agent-CLI state file(s) out of the patch: ${[...ignoredToolFiles].slice(0, 3).join(", ")}${ignoredToolFiles.size > 3 ? ", ..." : ""}`);
  }
  await writeFile(join(dir, "patch.diff"), diff.patch);
  const report: RunReport = {
    version: 1,
    id,
    task: options.task,
    status,
    baseRevision: base,
    startedAt,
    durationMs: Date.now() - started,
    writer: { vendor: options.writer, model: writerModel },
    reviewer: options.reviewer === "none" ? null : { vendor: options.reviewer, model: reviewerModel },
    verifyCommand,
    verifySource,
    verifications,
    reviews,
    steps,
    repairsAllowed: options.repairs,
    repairsUsed,
    files: diff.files,
    diffstat: diff.stat,
    insertions: diff.insertions,
    deletions: diff.deletions,
    warnings,
    appliedAt: null,
  };
  await writeReport(root, report);
  await writeFile(join(dir, "report.md"), renderReportMarkdown(report));
  await writeFile(join(dir, "events.json"), JSON.stringify(progress.stream(), null, 2) + "\n");
  const lastReview = reviews.at(-1);
  await appendLedger(root, {
    kind: "run",
    id,
    date: startedAt,
    status,
    writer: options.writer,
    writerModel,
    reviewer: options.reviewer,
    reviewerModel,
    verifyPassedFirstTry: verifications[0]?.passed ?? null,
    verifyPassedFinal: verifications.at(-1)?.passed ?? null,
    blockingFindings: reviews.reduce((n, r) => n + (r.status === "ok" ? r.blocking.length : 0), 0),
    repairs: repairsUsed,
    approved: options.reviewer === "none" || status === "no-changes" || status === "writer-failed" ? null : lastReview?.status === "ok" && lastReview.verdict === "approve",
    applied: false,
    durationMs: report.durationMs,
  });
  return { report, runDir: dir, root };
}
