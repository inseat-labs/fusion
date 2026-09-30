import { appendFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { LedgerLineSchema, RunReportSchema, type LedgerLine, type RunLedgerEntry, type RunReport } from "../schemas/run.js";
import { FusionError, git, removeWorktree, repoRoot } from "./git.js";

export const RUN_ID_PATTERN = /^\d{8}-\d{6}-[0-9a-f]{4}$/;

export function fusionDir(root: string): string {
  return join(root, ".fusion");
}

export function runsDir(root: string): string {
  return join(fusionDir(root), "runs");
}

export function runDir(root: string, id: string): string {
  if (!RUN_ID_PATTERN.test(id)) throw new FusionError(`invalid run id: ${id}`);
  const dir = resolve(runsDir(root), id);
  if (!dir.startsWith(runsDir(root) + sep)) throw new FusionError(`run id escapes .fusion/runs: ${id}`);
  return dir;
}

export function ledgerPath(root: string): string {
  return join(fusionDir(root), "ledger.jsonl");
}

export async function appendLedger(root: string, line: LedgerLine): Promise<void> {
  await mkdir(fusionDir(root), { recursive: true });
  await appendFile(ledgerPath(root), JSON.stringify(LedgerLineSchema.parse(line)) + "\n");
}

export async function readLedger(root: string): Promise<RunLedgerEntry[]> {
  const text = await readFile(ledgerPath(root), "utf8").catch(() => "");
  const runs = new Map<string, RunLedgerEntry>();
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      continue;
    }
    const parsed = LedgerLineSchema.safeParse(json);
    if (!parsed.success) continue;
    const line = parsed.data;
    if (line.kind === "run") runs.set(line.id, line);
    else {
      const run = runs.get(line.id);
      if (run) run.applied = true;
    }
  }
  return [...runs.values()];
}

export async function listRunIds(root: string): Promise<string[]> {
  const entries = await readdir(runsDir(root), { withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isDirectory() && RUN_ID_PATTERN.test(e.name)).map((e) => e.name).sort();
}

export async function resolveRunId(root: string, idOrLatest: string | undefined): Promise<string> {
  if (!idOrLatest) throw new FusionError("missing run id (use a run id or `latest`)");
  if (idOrLatest !== "latest") {
    runDir(root, idOrLatest);
    return idOrLatest;
  }
  const ids = await listRunIds(root);
  const latest = ids.at(-1);
  if (!latest) throw new FusionError("no runs found in .fusion/runs");
  return latest;
}

export async function readReport(root: string, id: string): Promise<RunReport | null> {
  const text = await readFile(join(runDir(root, id), "report.json"), "utf8").catch(() => null);
  if (text === null) return null;
  const parsed = RunReportSchema.safeParse(JSON.parse(text));
  return parsed.success ? parsed.data : null;
}

export async function writeReport(root: string, report: RunReport): Promise<void> {
  await writeFile(join(runDir(root, report.id), "report.json"), JSON.stringify(report, null, 2) + "\n");
}

export interface ApplyResult {
  id: string;
  ok: boolean;
  message: string;
}

export async function applyRun(cwd: string, idOrLatest: string | undefined): Promise<ApplyResult> {
  const root = await repoRoot(cwd);
  const id = await resolveRunId(root, idOrLatest);
  const patchPath = join(runDir(root, id), "patch.diff");
  const patch = await readFile(patchPath, "utf8").catch(() => null);
  if (patch === null) throw new FusionError(`run ${id} has no patch.diff; nothing to apply`);
  if (patch.trim() === "") throw new FusionError(`run ${id} produced an empty patch; nothing to apply`);
  try {
    await git(root, ["apply", "--3way", "--whitespace=nowarn", patchPath]);
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? (error as Error).message;
    return { id, ok: false, message: `git apply --3way failed for run ${id}:\n${stderr.trim()}` };
  }
  const date = new Date().toISOString();
  await appendLedger(root, { kind: "apply", id, date });
  const report = await readReport(root, id);
  if (report) await writeReport(root, { ...report, appliedAt: date });
  const files = report ? `${report.files.length} file(s): ${report.files.join(", ")}` : "patch";
  return { id, ok: true, message: `applied run ${id} to your working tree (${files}). Review with \`git diff HEAD\` (--3way also stages it); nothing was committed.` };
}

export async function discardRun(cwd: string, idOrLatest: string | undefined): Promise<string> {
  const root = await repoRoot(cwd);
  const id = await resolveRunId(root, idOrLatest);
  const dir = runDir(root, id);
  await removeWorktree(root, join(dir, "work"));
  await rm(dir, { recursive: true, force: true });
  return `discarded run ${id} (${relative(root, dir)}); ledger entry kept for stats`;
}

export interface ListedRun {
  id: string;
  status: string;
  writer: string;
  reviewer: string;
  verify: string;
  verdict: string;
  files: number;
  applied: boolean;
  task: string;
}

export async function listRuns(cwd: string): Promise<ListedRun[]> {
  const root = await repoRoot(cwd);
  const out: ListedRun[] = [];
  for (const id of await listRunIds(root)) {
    const r = await readReport(root, id);
    if (!r) {
      out.push({ id, status: "incomplete", writer: "-", reviewer: "-", verify: "-", verdict: "-", files: 0, applied: false, task: "(no report.json; run was interrupted)" });
      continue;
    }
    const lastVerify = r.verifications.at(-1);
    const lastReview = r.reviews.at(-1);
    out.push({
      id,
      status: r.status,
      writer: r.writer.vendor,
      reviewer: r.reviewer?.vendor ?? "none",
      verify: lastVerify ? (lastVerify.passed ? "PASS" : "FAIL") : "none",
      verdict: !r.reviewer ? "-" : !lastReview ? "not-run" : lastReview.status === "ok" ? lastReview.verdict : "unavailable",
      files: r.files.length,
      applied: r.appliedAt !== null,
      task: r.task,
    });
  }
  return out;
}

export interface WriterStats {
  writer: string;
  runs: number;
  verifiedRuns: number;
  firstTryPass: number;
  finalPass: number;
  reviewedRuns: number;
  approved: number;
  totalRepairs: number;
  totalBlocking: number;
  applied: number;
  avgDurationMs: number;
}

export async function computeStats(cwd: string): Promise<WriterStats[]> {
  const root = await repoRoot(cwd);
  const byWriter = new Map<string, RunLedgerEntry[]>();
  for (const e of await readLedger(root)) {
    const key = e.writerModel ? `${e.writer} (${e.writerModel})` : e.writer;
    byWriter.set(key, [...(byWriter.get(key) ?? []), e]);
  }
  return [...byWriter.entries()]
    .map(([writer, runs]) => {
      const verified = runs.filter((r) => r.verifyPassedFirstTry !== null);
      const reviewed = runs.filter((r) => r.approved !== null);
      return {
        writer,
        runs: runs.length,
        verifiedRuns: verified.length,
        firstTryPass: verified.filter((r) => r.verifyPassedFirstTry).length,
        finalPass: verified.filter((r) => r.verifyPassedFinal).length,
        reviewedRuns: reviewed.length,
        approved: reviewed.filter((r) => r.approved).length,
        totalRepairs: runs.reduce((s, r) => s + r.repairs, 0),
        totalBlocking: runs.reduce((s, r) => s + r.blockingFindings, 0),
        applied: runs.filter((r) => r.applied).length,
        avgDurationMs: Math.round(runs.reduce((s, r) => s + r.durationMs, 0) / runs.length),
      };
    })
    .sort((a, b) => b.runs - a.runs);
}
