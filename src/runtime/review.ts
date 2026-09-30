import { ReviewSchema, type Finding, type ReviewOutcome, type VerifyOutcome } from "../schemas/run.js";
import { tail } from "./process.js";

const MAX_DIFF_CHARS = 120_000;

export function writerPrompt(task: string, verifyCommand: string | null): string {
  return [
    "Task:",
    task,
    "",
    "---",
    "Context from fusion:",
    "- You are working in an isolated git worktree of the user's repository (the current directory). Edit files directly to complete the task.",
    "- Do not commit, create branches, or push; Fusion collects your changes as a patch.",
    verifyCommand
      ? `- After you finish, Fusion will run \`${verifyCommand}\` in this directory. The change is only accepted if it passes.`
      : "- No automated verification command is configured, so be careful and keep the change minimal.",
    "- A reviewer from a different vendor will then review your diff.",
    "- Finish with a short summary of what you changed.",
  ].join("\n");
}

export function repairPrompt(task: string, verifyCommand: string | null, verify: VerifyOutcome | null, blocking: Finding[]): string {
  const parts = [
    "You previously worked on this task in the current directory:",
    "",
    task,
    "",
    "---",
    "Your change is still in the working tree, but it is not accepted yet. Fix the problems below without reverting correct work. Do not commit.",
  ];
  if (verify && !verify.passed) {
    parts.push("", `Verification \`${verify.command}\` FAILED (exit ${verify.exitCode ?? "none"}${verify.timedOut ? ", timed out" : ""}). Output tail:`, "```", tail(verify.outputTail, 6000), "```");
  }
  if (blocking.length > 0) {
    parts.push("", "A code reviewer raised these blocking findings:");
    for (const f of blocking) parts.push(`- ${formatFinding(f)}`);
  }
  if (verifyCommand) parts.push("", `Fusion will re-run \`${verifyCommand}\` afterwards.`);
  parts.push("Finish with a short summary of what you changed.");
  return parts.join("\n");
}

export function reviewPrompt(task: string, diff: string, verify: VerifyOutcome | null): string {
  const shownDiff = diff.length > MAX_DIFF_CHARS ? `${diff.slice(0, MAX_DIFF_CHARS)}\n…[diff truncated, ${diff.length - MAX_DIFF_CHARS} more chars; read the files in the working tree for the rest]` : diff;
  const verifyLine = verify
    ? `Verification \`${verify.command}\` ${verify.passed ? "PASSED" : `FAILED (exit ${verify.exitCode ?? "none"})`}.`
    : "No automated verification command was run.";
  return [
    "You are a strict, read-only code reviewer. Do NOT modify any files.",
    "Another coding agent made the change below in the current directory to accomplish this task:",
    "",
    "<task>",
    task,
    "</task>",
    "",
    verifyLine,
    verify && !verify.passed ? `Verification output tail:\n\`\`\`\n${tail(verify.outputTail, 4000)}\n\`\`\`` : "",
    "",
    "<diff>",
    shownDiff,
    "</diff>",
    "",
    "Review for correctness bugs, regressions, missed requirements of the task, and security problems. You may read files in the working tree for context.",
    "Review it yourself: do not spawn or delegate to sub-agents, and keep the review proportional to the size of the diff.",
    "Only mark something blocking if it is a real defect that should stop this patch from being merged. Style nits go in suggestions.",
    "",
    "Respond with ONLY one JSON object, no prose before or after, exactly in this shape:",
    '{"verdict":"approve"|"changes","blocking":[{"file":"path","line":12,"issue":"what is wrong and why"}],"suggestions":["optional non-blocking note"]}',
    'Use "changes" if and only if "blocking" is non-empty.',
  ]
    .filter((l) => l !== "")
    .join("\n");
}

/** Accepts bare JSON, fenced JSON, or JSON embedded in prose; anything else is "unavailable", never approval. */
export function parseReview(text: string): ReviewOutcome {
  const candidates: string[] = [];
  const trimmed = text.trim();
  if (trimmed) candidates.push(trimmed);
  for (const m of trimmed.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)) if (m[1]) candidates.push(m[1].trim());
  candidates.push(...balancedObjects(trimmed).reverse());

  for (const candidate of candidates) {
    let json: unknown;
    try {
      json = JSON.parse(candidate);
    } catch {
      continue;
    }
    const parsed = ReviewSchema.safeParse(json);
    if (!parsed.success) continue;
    const r = parsed.data;
    const suggestions = r.suggestions.map((s) => (typeof s === "string" ? s : s.issue));
    // A reviewer that lists blocking findings has not approved, whatever the verdict field says.
    const verdict = r.blocking.length > 0 ? "changes" : r.verdict;
    if (verdict === "changes" && r.blocking.length === 0) {
      return { status: "ok", verdict, blocking: [{ file: "", issue: "reviewer requested changes without listing a specific finding" }], suggestions };
    }
    return { status: "ok", verdict, blocking: r.blocking, suggestions };
  }
  return { status: "unavailable", reason: trimmed ? "reviewer output did not contain the required JSON verdict" : "reviewer produced no output" };
}

function balancedObjects(text: string): string[] {
  const found: string[] = [];
  for (let start = text.indexOf("{"); start !== -1; start = text.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        found.push(text.slice(start, i + 1));
        break;
      }
    }
  }
  return found;
}

export function formatFinding(f: Finding): string {
  const where = f.file ? `${f.file}${f.line !== undefined && f.line !== null && f.line !== "" ? `:${f.line}` : ""}: ` : "";
  return `${where}${f.issue}`;
}
