import type { RunReport } from "../schemas/run.js";
import { formatFinding } from "./review.js";
import type { ListedRun, WriterStats } from "./runs.js";

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

function who(vendor: string, model: string | null): string {
  return model ? `${vendor} (${model})` : vendor;
}

function headline(r: RunReport): string {
  const reviewer = r.reviewer?.vendor ?? "reviewer";
  switch (r.status) {
    case "ready": {
      const parts = [r.verifyCommand ? "verify passed" : "NO verify gate", r.reviewer ? `${reviewer} approved` : "no reviewer"];
      return `READY: ${parts.join(", ")}. Your branch is untouched.`;
    }
    case "needs-attention":
      return "NEEDS ATTENTION: patch kept but not accepted (see verify/review below). Your branch is untouched.";
    case "no-changes":
      return "NO CHANGES: the writer did not modify any files.";
    case "writer-failed":
      return "WRITER FAILED: see the writer log. Your branch is untouched.";
  }
}

export function renderSummary(r: RunReport, runRel: string): string {
  const lines: string[] = [];
  const row = (k: string, v: string) => lines.push(`${k.padEnd(10)}${v}`);
  lines.push(`== fusion run ${r.id} ==`);
  row("Task", r.task.length > 200 ? `${r.task.slice(0, 200)}…` : r.task);
  row("Status", headline(r));
  const writerSteps = r.steps.filter((s) => s.kind !== "review");
  row("Writer", `${who(r.writer.vendor, r.writer.model)}  ${writerSteps.map((s) => `${s.kind} ${s.outcome} ${formatDuration(s.durationMs)}`).join(", ")}`);

  const last = r.verifications.at(-1);
  if (!r.verifyCommand) row("Verify", "NONE  (no --verify and no package.json test script; nothing was tested)");
  else if (!last) row("Verify", `not run  (${r.verifyCommand})`);
  else {
    const history = r.verifications.length > 1 ? `  (attempts: ${r.verifications.map((v) => (v.passed ? "PASS" : "FAIL")).join(" -> ")})` : "";
    row("Verify", `${last.passed ? "PASS" : "FAIL"}  ${r.verifyCommand}${history}${last.timedOut ? "  timed out" : ""}`);
    if (!last.passed) {
      for (const l of last.outputTail.trimEnd().split("\n").slice(-8)) lines.push(`            | ${l}`);
    }
  }

  if (!r.reviewer) row("Reviewer", "none");
  else {
    const review = r.reviews.at(-1);
    if (!review) row("Reviewer", `${who(r.reviewer.vendor, r.reviewer.model)}  not run`);
    else if (review.status === "unavailable") row("Reviewer", `${who(r.reviewer.vendor, r.reviewer.model)}  UNAVAILABLE (not an approval): ${review.reason}`);
    else {
      const history = r.reviews.length > 1 ? `  (reviews: ${r.reviews.map((x) => (x.status === "ok" ? x.verdict : "unavailable")).join(" -> ")})` : "";
      row("Reviewer", `${who(r.reviewer.vendor, r.reviewer.model)}  ${review.verdict.toUpperCase()}  ${review.blocking.length} blocking, ${review.suggestions.length} suggestion(s)${history}`);
      for (const f of review.blocking) lines.push(`            blocking: ${formatFinding(f)}`);
      for (const s of review.suggestions.slice(0, 5)) lines.push(`            suggestion: ${s}`);
    }
  }
  row("Repairs", `${r.repairsUsed} of ${r.repairsAllowed} used`);
  row("Changed", r.files.length === 0 ? "no files" : `${r.files.length} file(s), +${r.insertions} -${r.deletions}`);
  if (r.diffstat) for (const l of r.diffstat.split("\n")) lines.push(`          ${l.trim()}`);
  const cost = r.steps.map((s) => s.costUsd).filter((c): c is number => c !== null);
  row("Duration", `${formatDuration(r.durationMs)}${cost.length > 0 ? `  (CLI-reported cost estimate: $${cost.reduce((a, b) => a + b, 0).toFixed(4)}; other legs report no cost)` : ""}`);
  row("Artifacts", `${runRel}/  (patch.diff, report.md, report.json, events.json, logs/)`);
  if (r.warnings.length > 0) {
    lines.push("Warnings");
    for (const w of r.warnings) lines.push(`  ! ${w}`);
  }
  lines.push("", "Next");
  if (r.files.length > 0) {
    lines.push(`  git -C ${runRel}/work diff HEAD      inspect the change`);
    lines.push(`  fusion apply ${r.id}   apply the patch to your working tree (git apply --3way)`);
  }
  lines.push(`  fusion discard ${r.id} remove the worktree and run files`);
  lines.push(`  fusion stats                      which writer delivers in this repo`);
  return lines.join("\n");
}

export function renderReportMarkdown(r: RunReport): string {
  const out: string[] = [`# Fusion run ${r.id}`, "", `- **Task:** ${r.task}`, `- **Status:** ${r.status}`, `- **Base:** ${r.baseRevision}`, `- **Writer:** ${who(r.writer.vendor, r.writer.model)}`];
  out.push(`- **Reviewer:** ${r.reviewer ? who(r.reviewer.vendor, r.reviewer.model) : "none"}`);
  out.push(`- **Verify:** ${r.verifyCommand ? `\`${r.verifyCommand}\` (${r.verifySource})` : "none"}`);
  out.push(`- **Repairs:** ${r.repairsUsed} of ${r.repairsAllowed}`, `- **Duration:** ${formatDuration(r.durationMs)}`, "");
  out.push("## Steps", "", "| # | Kind | Agent | Outcome | Duration | Log |", "| --- | --- | --- | --- | --- | --- |");
  r.steps.forEach((s, i) => out.push(`| ${i + 1} | ${s.kind} | ${who(s.vendor, s.model)} | ${s.outcome} | ${formatDuration(s.durationMs)} | ${s.log} |`));
  out.push("", "## Verification", "");
  if (r.verifications.length === 0) out.push("Not run.");
  r.verifications.forEach((v, i) => {
    out.push(`### Attempt ${i + 1}: ${v.passed ? "PASS" : "FAIL"} (exit ${v.exitCode ?? "none"}${v.timedOut ? ", timed out" : ""})`, "", "```", v.outputTail.trimEnd(), "```", "");
  });
  out.push("## Reviews", "");
  if (r.reviews.length === 0) out.push("None.");
  r.reviews.forEach((rv, i) => {
    if (rv.status === "unavailable") {
      out.push(`### Review ${i + 1}: unavailable`, "", rv.reason, "");
      return;
    }
    out.push(`### Review ${i + 1}: ${rv.verdict}`, "");
    for (const f of rv.blocking) out.push(`- **blocking** ${formatFinding(f)}`);
    for (const s of rv.suggestions) out.push(`- suggestion: ${s}`);
    out.push("");
  });
  out.push("## Changed files", "", "```", r.diffstat || "(none)", "```", "");
  if (r.warnings.length > 0) out.push("## Warnings", "", ...r.warnings.map((w) => `- ${w}`), "");
  return out.join("\n");
}

export function renderList(runs: ListedRun[]): string {
  if (runs.length === 0) return "no runs yet. Start one with: fusion run \"<task>\"";
  const header = ["ID", "STATUS", "WRITER>REVIEWER", "VERIFY", "REVIEW", "FILES", "APPLIED", "TASK"];
  const rows = runs.map((r) => [r.id, r.status, `${r.writer}>${r.reviewer}`, r.verify, r.verdict, String(r.files), r.applied ? "yes" : "no", r.task.length > 60 ? `${r.task.slice(0, 57)}...` : r.task]);
  return table(header, rows);
}

const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${Math.round((100 * n) / d)}% (${n}/${d})`);

export function renderStats(stats: WriterStats[]): string {
  if (stats.length === 0) return "no runs in .fusion/ledger.jsonl yet.";
  const header = ["WRITER", "RUNS", "VERIFY 1ST TRY", "VERIFY FINAL", "APPROVED", "AVG REPAIRS", "BLOCKING/RUN", "APPLIED", "AVG TIME"];
  const rows = stats.map((s) => [
    s.writer,
    String(s.runs),
    pct(s.firstTryPass, s.verifiedRuns),
    pct(s.finalPass, s.verifiedRuns),
    pct(s.approved, s.reviewedRuns),
    (s.totalRepairs / s.runs).toFixed(2),
    (s.totalBlocking / s.runs).toFixed(2),
    String(s.applied),
    formatDuration(s.avgDurationMs),
  ]);
  return `${table(header, rows)}\n\nWhich agent delivers in this repo, from your own runs (.fusion/ledger.jsonl). Small samples are noisy.`;
}

function table(header: string[], rows: string[][]): string {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const fmt = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join("  ").trimEnd();
  return [fmt(header), ...rows.map(fmt)].join("\n");
}
