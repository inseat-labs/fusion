#!/usr/bin/env node
import { readFile, realpath } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { FusionError } from "../runtime/git.js";
import { killAllActive } from "../runtime/process.js";
import { renderList, renderStats, renderSummary } from "../runtime/render.js";
import { otherVendor, prepareRun, runFusion, type RunOptions } from "../runtime/run.js";
import { applyRun, computeStats, discardRun, listRuns } from "../runtime/runs.js";
import { VendorSchema, type Vendor } from "../schemas/run.js";
import { ledgerFromDryRun, serializeLedger } from "../ledger/ledger.js";
import { buildDryRunPlan, PlanError } from "../planner/plan.js";
import { renderPlan } from "../planner/render.js";
import { DEFAULT_POLICY } from "../policy/default-policy.js";
import { PolicySchema, type Policy } from "../schemas/policy.js";
import { TaskSchema, type Task } from "../schemas/task.js";
import { SCENARIOS, simulateProgress, SimulationError, type Scenario } from "../progress/simulate.js";
import { validateProgressStream } from "../progress/validate.js";

const USAGE = `fusion — one command: one agent writes, your tests check, the other vendor reviews, one repair.
You get a verified patch in an isolated worktree; your branch is never touched.

Usage:
  fusion run "<task>" [--verify "<cmd>"] [--writer claude|codex] [--reviewer codex|claude|none]
                    [--repairs 0|1|2] [--model-writer <m>] [--model-reviewer <m>] [--timeout <sec>] [--yes]
  fusion apply <id|latest>      git apply --3way the run's patch into your working tree
  fusion discard <id|latest>    remove the run's worktree and files (ledger entry is kept)
  fusion list                   runs in this repo with their status
  fusion stats                  per-writer verify pass rate, approval rate, repairs

Advanced (dry-run, nothing executed):
  fusion plan <task.json>... [--policy <policy.json>] [--json] [--ledger]
  fusion simulate <task.json> --scenario <nominal|cancelled|timed-out|budget-exhausted> [--at <legIndex>] [--policy <policy.json>]
  fusion validate-events <stream.json>...
  fusion --help

Global:
  -C <dir>           Run as if started in <dir>.

run options:
  --verify <cmd>     Shell command that must pass (default: "npm test" if package.json has a test script).
  --writer <v>       claude (default) or codex. Edits files in .fusion/runs/<id>/work.
  --reviewer <v>     Read-only reviewer; defaults to the other vendor. "none" skips review.
  --repairs <n>      Repair rounds after a failed verify or blocking review (default 1, max 2).
  --model-writer, --model-reviewer   Model passed to the CLI (default: the CLI's configured default).
  --timeout <sec>    Per-step timeout; kills the whole process group (default 900).
  --yes              Do not ask for confirmation before spending CLI quota.
  Agent executables can be overridden with FUSION_CLAUDE_BIN / FUSION_CODEX_BIN.

plan/simulate options:
  --policy <file>    Use a custom static policy instead of the built-in default.
  --json             Emit the DryRunPlan JSON instead of text (plan only).
  --ledger           Emit the dry-run ledger JSON, secrets redacted by key name (plan only).
  --scenario <name>  Fault to simulate (simulate only).
  --at <legIndex>    Leg at which the fault occurs; default 0 (simulate only).

plan, simulate, and validate-events launch no provider CLI and modify no repository.

Exit codes:
  0  success (run: patch is READY; validate-events: every stream valid)
  1  run finished but the patch is not ready; apply failed; validate-events found a violation
  2  usage error, invalid input, or setup failure
`;

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new PlanError(`${path}: ${(error as Error).message}`);
  }
}

function formatIssues(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`).join("; ");
}

export async function main(argv: string[]): Promise<number> {
  let cwd = process.cwd();
  if (argv[0] === "-C") {
    if (!argv[1]) {
      process.stderr.write("-C requires a directory\n");
      return 2;
    }
    cwd = resolve(argv[1]);
    argv = argv.slice(2);
  }
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(USAGE);
    return command ? 0 : 2;
  }
  if (command === "simulate") return simulate(rest);
  if (command === "validate-events") return validateEvents(rest);
  if (RUNTIME_COMMANDS.has(command)) {
    try {
      return await runtimeCommand(command, rest, cwd);
    } catch (error) {
      if (error instanceof FusionError) {
        process.stderr.write(`fusion: ${error.message}\n`);
        return 2;
      }
      throw error;
    }
  }
  if (command !== "plan") {
    process.stderr.write(`unknown command: ${command}\n\n${USAGE}`);
    return 2;
  }

  const json = rest.includes("--json");
  const ledger = rest.includes("--ledger");
  const policyIdx = rest.indexOf("--policy");
  const policyPath = policyIdx >= 0 ? rest[policyIdx + 1] : undefined;
  const policyValueIdx = policyIdx >= 0 ? policyIdx + 1 : -1;
  const paths = rest.filter((a, i) => !a.startsWith("--") && i !== policyValueIdx);

  if (paths.length === 0) {
    process.stderr.write(`plan requires at least one task path\n\n${USAGE}`);
    return 2;
  }

  try {
    const policy = await loadPolicy(policyPath);
    const outputs: string[] = [];
    for (const path of paths) {
      const plan = buildDryRunPlan(await loadTask(path), policy);
      if (ledger) outputs.push(serializeLedger(ledgerFromDryRun(plan)));
      else if (json) outputs.push(JSON.stringify(plan, null, 2));
      else outputs.push(renderPlan(plan));
    }
    process.stdout.write(outputs.join("\n\n") + "\n");
    return 0;
  } catch (error) {
    if (error instanceof PlanError) {
      process.stderr.write(`${error.message}\n`);
      return 2;
    }
    throw error;
  }
}

const RUNTIME_COMMANDS = new Set(["run", "apply", "discard", "list", "stats"]);

const RUN_VALUE_FLAGS = new Set(["--verify", "--writer", "--reviewer", "--repairs", "--model-writer", "--model-reviewer", "--timeout"]);

function parseRunArgs(rest: string[], cwd: string): { options: RunOptions; yes: boolean } {
  const values = new Map<string, string>();
  const positional: string[] = [];
  let yes = false;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === "--yes" || arg === "-y") yes = true;
    else if (RUN_VALUE_FLAGS.has(arg)) {
      const value = rest[++i];
      if (value === undefined) throw new FusionError(`${arg} requires a value`);
      values.set(arg, value);
    } else if (arg.startsWith("--")) throw new FusionError(`unknown option for run: ${arg}`);
    else positional.push(arg);
  }
  if (positional.length !== 1) throw new FusionError(`run takes exactly one quoted task, e.g. fusion run "Fix the failing slugify tests"`);
  const vendor = (flag: string, fallback: Vendor): Vendor => {
    const v = values.get(flag);
    if (v === undefined) return fallback;
    const parsed = VendorSchema.safeParse(v);
    if (!parsed.success) throw new FusionError(`${flag} must be claude or codex`);
    return parsed.data;
  };
  const writer = vendor("--writer", "claude");
  const reviewerRaw = values.get("--reviewer");
  const reviewer = reviewerRaw === "none" ? "none" : vendor("--reviewer", otherVendor(writer));
  const repairs = Number(values.get("--repairs") ?? 1);
  const timeoutSeconds = Number(values.get("--timeout") ?? 900);
  const options: RunOptions = { cwd, task: positional[0]!, writer, reviewer, repairs, timeoutSeconds };
  if (values.has("--verify")) options.verify = values.get("--verify")!;
  if (values.has("--model-writer")) options.writerModel = values.get("--model-writer")!;
  if (values.has("--model-reviewer")) options.reviewerModel = values.get("--model-reviewer")!;
  return { options, yes };
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return /^y(es)?$/i.test((await rl.question(question)).trim());
  } finally {
    rl.close();
  }
}

async function runtimeCommand(command: string, rest: string[], cwd: string): Promise<number> {
  const out = (s: string) => process.stdout.write(s + "\n");
  const err = (s: string) => process.stderr.write(s + "\n");
  switch (command) {
    case "list":
      out(renderList(await listRuns(cwd)));
      return 0;
    case "stats":
      out(renderStats(await computeStats(cwd)));
      return 0;
    case "apply": {
      const result = await applyRun(cwd, rest[0]);
      (result.ok ? out : err)(result.message);
      return result.ok ? 0 : 1;
    }
    case "discard":
      out(await discardRun(cwd, rest[0]));
      return 0;
  }

  const { options, yes } = parseRunArgs(rest, cwd);
  if (!yes && process.stdin.isTTY) {
    const pre = await prepareRun(options);
    err(`fusion will run in an isolated worktree of ${pre.root} (your branch is not touched):`);
    err(`  writer:   ${options.writer}${options.writerModel ? ` (${options.writerModel})` : ""}`);
    err(`  verify:   ${pre.verifyCommand ?? "NONE (no verify gate)"}`);
    err(`  reviewer: ${options.reviewer}${options.reviewerModel ? ` (${options.reviewerModel})` : ""}`);
    err(`  repairs:  up to ${options.repairs}; timeout ${options.timeoutSeconds}s per step`);
    err("This uses your own Claude Code / Codex CLI logins and quota.");
    if (!(await confirm("Proceed? [y/N] "))) {
      err("aborted.");
      return 1;
    }
  }
  const onSigint = () => {
    killAllActive();
    err("\nfusion: cancelled; agent processes killed. Your branch is untouched. Clean up with `fusion discard latest`.");
    process.exit(130);
  };
  process.once("SIGINT", onSigint);
  try {
    const { report, runDir, root } = await runFusion(options, { status: (s) => err(`fusion ${s}`), warn: (s) => err(`fusion WARNING: ${s}`) });
    out("");
    out(renderSummary(report, relative(cwd, runDir) || runDir.replace(root, ".")));
    return report.status === "ready" ? 0 : 1;
  } finally {
    process.removeListener("SIGINT", onSigint);
  }
}

async function loadPolicy(path: string | undefined): Promise<Policy> {
  if (!path) return DEFAULT_POLICY;
  const parsed = PolicySchema.safeParse(await readJson(path));
  if (!parsed.success) throw new PlanError(`${path}: invalid policy: ${formatIssues(parsed.error.issues)}`);
  return parsed.data;
}

async function loadTask(path: string): Promise<Task> {
  const parsed = TaskSchema.safeParse(await readJson(path));
  if (!parsed.success) throw new PlanError(`${path}: invalid task: ${formatIssues(parsed.error.issues)}`);
  return parsed.data;
}

function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

function positionals(args: string[], valueFlags: string[]): string[] {
  const skip = new Set(valueFlags.map((f) => args.indexOf(f) + 1).filter((i) => i > 0));
  return args.filter((a, i) => !a.startsWith("--") && !skip.has(i));
}

async function simulate(rest: string[]): Promise<number> {
  const scenario = flagValue(rest, "--scenario");
  const at = flagValue(rest, "--at");
  const [taskPath, ...extra] = positionals(rest, ["--scenario", "--at", "--policy"]);
  if (!taskPath || extra.length > 0 || !scenario || !(SCENARIOS as readonly string[]).includes(scenario)) {
    process.stderr.write(`simulate requires exactly one task path and --scenario <${SCENARIOS.join("|")}>\n\n${USAGE}`);
    return 2;
  }
  const atLeg = at !== undefined ? Number(at) : undefined;
  if (atLeg !== undefined && (!Number.isInteger(atLeg) || atLeg < 0)) {
    process.stderr.write(`--at must be a non-negative integer\n`);
    return 2;
  }
  try {
    const plan = buildDryRunPlan(await loadTask(taskPath), await loadPolicy(flagValue(rest, "--policy")));
    const stream = simulateProgress(plan, { scenario: scenario as Scenario, ...(atLeg !== undefined ? { atLeg } : {}) });
    process.stdout.write(JSON.stringify(stream, null, 2) + "\n");
    return 0;
  } catch (error) {
    if (error instanceof PlanError || error instanceof SimulationError) {
      process.stderr.write(`${error.message}\n`);
      return 2;
    }
    throw error;
  }
}

async function validateEvents(rest: string[]): Promise<number> {
  const paths = positionals(rest, []);
  if (paths.length === 0) {
    process.stderr.write(`validate-events requires at least one stream path\n\n${USAGE}`);
    return 2;
  }
  let invalid = 0;
  for (const path of paths) {
    let input: unknown;
    try {
      input = await readJson(path);
    } catch (error) {
      process.stderr.write(`${(error as Error).message}\n`);
      return 2;
    }
    const result = validateProgressStream(input);
    if (result.ok) {
      const states = Object.entries(result.finalStates).map(([leg, s]) => `${leg}=${s}`).join(" ");
      process.stdout.write(`VALID    ${path}  ${result.eventCount} event(s)  ${states}\n`);
    } else {
      invalid += 1;
      process.stdout.write(`INVALID  ${path}\n`);
      for (const v of result.violations) {
        process.stdout.write(`         [${v.code}] seq=${v.sequence ?? "-"} ${v.legId ?? ""} ${v.message}\n`);
      }
    }
  }
  return invalid > 0 ? 1 : 0;
}

const entry = process.argv[1] ? await realpath(process.argv[1]).catch(() => null) : null;
if (entry && entry === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      process.stderr.write(`${(error as Error).stack ?? error}\n`);
      process.exit(2);
    },
  );
}
