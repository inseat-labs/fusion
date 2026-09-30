import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../src/cli/main.js";
import { validateProgressStream } from "../src/progress/validate.js";
import { FusionError } from "../src/runtime/git.js";
import { parseReview } from "../src/runtime/review.js";
import { detectVerifyCommand, runFusion, type RunOptions } from "../src/runtime/run.js";
import { readLedger } from "../src/runtime/runs.js";
import { APPROVE, makeFakeAgents, makeRepo, sh, type FakeAgents } from "./helpers/fake-agents.js";

const silent = { status: () => undefined, warn: () => undefined };

function options(repo: string, fakes: FakeAgents, extra: Partial<RunOptions> = {}): RunOptions {
  return {
    cwd: repo,
    task: "make value.txt say fixed",
    verify: "node check.js",
    writer: "claude",
    reviewer: "codex",
    repairs: 1,
    timeoutSeconds: 20,
    bins: fakes.bins,
    env: fakes.env,
    ...extra,
  };
}

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  const o = process.stdout.write.bind(process.stdout);
  const e = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((c: string | Uint8Array) => (out.push(String(c)), true)) as typeof process.stdout.write;
  process.stderr.write = ((c: string | Uint8Array) => (err.push(String(c)), true)) as typeof process.stderr.write;
  return {
    out: () => out.join(""),
    err: () => err.join(""),
    restore: () => {
      process.stdout.write = o;
      process.stderr.write = e;
    },
  };
}

async function cli(args: string[], env: NodeJS.ProcessEnv = {}) {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  const cap = capture();
  try {
    const code = await main(args);
    return { code, out: cap.out(), err: cap.err() };
  } finally {
    cap.restore();
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
}

describe("fusion run", () => {
  it("happy path: writer fixes, verify passes, reviewer approves, user tree untouched", async () => {
    const repo = makeRepo();
    const fakes = makeFakeAgents({ claude: `write("value.txt", "fixed\\n"); reply("changed value.txt");`, codex: APPROVE });
    const { report, runDir } = await runFusion(options(repo, fakes), silent);

    expect(report.status).toBe("ready");
    expect(report.verifications.map((v) => v.passed)).toEqual([true]);
    expect(report.reviews).toEqual([{ status: "ok", verdict: "approve", blocking: [], suggestions: ["consider a comment"] }]);
    expect(report.repairsUsed).toBe(0);
    expect(report.files).toEqual(["value.txt"]);
    expect(readFileSync(join(runDir, "patch.diff"), "utf8")).toContain("+fixed");
    expect(existsSync(join(runDir, "report.md"))).toBe(true);
    expect(existsSync(join(runDir, "logs", "01-write-claude.log"))).toBe(true);

    // writer ran in the worktree with edit permissions; reviewer was read-only
    const w = fakes.args("claude", 1);
    expect(w.cwd).toBe(join(runDir, "work"));
    expect(w.args).toContain("acceptEdits");
    expect(fakes.args("codex", 1).args).toEqual(expect.arrayContaining(["exec", "--json", "--sandbox", "read-only"]));
    expect(fakes.args("codex", 1).args.at(-1)).toContain("+fixed");
    expect(fakes.args("codex", 1).args.at(-1)).toContain("do not spawn or delegate to sub-agents");

    expect(readFileSync(join(repo, "value.txt"), "utf8")).toBe("bug\n");
    expect(sh(repo, "git", ["status", "--porcelain"])).toBe("");
    expect(readFileSync(join(repo, ".git", "info", "exclude"), "utf8")).toContain("/.fusion/");

    const stream = JSON.parse(readFileSync(join(runDir, "events.json"), "utf8"));
    expect(stream.origin).toBe("runtime");
    expect(validateProgressStream(stream).ok).toBe(true);

    const ledger = await readLedger(repo);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ writer: "claude", reviewer: "codex", verifyPassedFirstTry: true, verifyPassedFinal: true, approved: true, repairs: 0, applied: false });
  });

  it("verify fails, writer repairs with the failure output, verify passes", async () => {
    const repo = makeRepo();
    const fakes = makeFakeAgents({
      claude: `if (call === 1) write("value.txt", "almost\\n"); else { fs.writeFileSync(path.join(process.env.FAKE_STATE_DIR, "repair-prompt.txt"), prompt); write("value.txt", "fixed\\n"); } reply("ok");`,
      codex: APPROVE,
    });
    const { report } = await runFusion(options(repo, fakes), silent);
    expect(report.status).toBe("ready");
    expect(report.verifications.map((v) => v.passed)).toEqual([false, true]);
    expect(report.repairsUsed).toBe(1);
    expect(fakes.calls("codex")).toBe(1); // review deferred until verify passed
    expect(readFileSync(join(fakes.stateDir, "repair-prompt.txt"), "utf8")).toContain("expected fixed, got almost");
    const [entry] = await readLedger(repo);
    expect(entry).toMatchObject({ verifyPassedFirstTry: false, verifyPassedFinal: true, repairs: 1, approved: true });
  });

  it("blocking review triggers one repair and a re-review", async () => {
    const repo = makeRepo();
    const fakes = makeFakeAgents({
      claude: `if (call === 1) { write("value.txt", "fixed\\n"); write("debug.log", "x"); } else { fs.writeFileSync(path.join(process.env.FAKE_STATE_DIR, "repair-prompt.txt"), prompt); fs.unlinkSync(path.join(process.cwd(), "debug.log")); } reply("ok");`,
      codex: `if (call === 1) reply("Here is my review:\\n\`\`\`json\\n" + JSON.stringify({ verdict: "changes", blocking: [{ file: "debug.log", line: 1, issue: "stray debug file committed" }], suggestions: [] }) + "\\n\`\`\`"); else reply(JSON.stringify({ verdict: "approve", blocking: [], suggestions: [] }));`,
    });
    const { report } = await runFusion(options(repo, fakes), silent);
    expect(report.status).toBe("ready");
    expect(report.reviews.map((r) => (r.status === "ok" ? r.verdict : r.status))).toEqual(["changes", "approve"]);
    expect(report.repairsUsed).toBe(1);
    expect(report.files).toEqual(["value.txt"]);
    expect(readFileSync(join(fakes.stateDir, "repair-prompt.txt"), "utf8")).toContain("debug.log:1: stray debug file committed");
    const [entry] = await readLedger(repo);
    expect(entry).toMatchObject({ blockingFindings: 1, repairs: 1, approved: true });
  });

  it("stops after the repair budget and reports needs-attention", async () => {
    const repo = makeRepo();
    const fakes = makeFakeAgents({ claude: `write("value.txt", "still-bug-" + call + "\\n"); reply("ok");`, codex: APPROVE });
    const { report } = await runFusion(options(repo, fakes, { repairs: 2 }), silent);
    expect(report.status).toBe("needs-attention");
    expect(report.repairsUsed).toBe(2);
    expect(fakes.calls("claude")).toBe(3);
    expect(report.verifications.map((v) => v.passed)).toEqual([false, false, false]);
  });

  it("an unparseable review is 'unavailable', never an approval", async () => {
    const repo = makeRepo();
    const fakes = makeFakeAgents({ claude: `write("value.txt", "fixed\\n"); reply("ok");`, codex: `reply("Looks great to me, ship it!");` });
    const { report } = await runFusion(options(repo, fakes), silent);
    expect(report.reviews[0]).toMatchObject({ status: "unavailable" });
    expect(report.status).toBe("needs-attention");
    expect(fakes.calls("claude")).toBe(1);
    const [entry] = await readLedger(repo);
    expect(entry?.approved).toBe(false);
  });

  it("kills a writer that exceeds the timeout, including its process group", async () => {
    const repo = makeRepo();
    const fakes = makeFakeAgents({
      claude: `const { spawn } = require("child_process"); const c = spawn(process.execPath, ["-e", "setTimeout(()=>{}, 60000)"], { stdio: "ignore" }); fs.writeFileSync(path.join(process.env.FAKE_STATE_DIR, "grandchild.pid"), String(c.pid)); setTimeout(() => {}, 60000);`,
    });
    const t0 = Date.now();
    const { report } = await runFusion(options(repo, fakes, { timeoutSeconds: 1 }), silent);
    expect(Date.now() - t0).toBeLessThan(10000);
    expect(report.status).toBe("writer-failed");
    expect(report.steps[0]?.outcome).toBe("timed-out");
    expect(fakes.calls("codex")).toBe(0);
    const pid = Number(readFileSync(join(fakes.stateDir, "grandchild.pid"), "utf8"));
    await new Promise((r) => setTimeout(r, 200));
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it("keeps agent-CLI state files out of the patch and passes extra CLI args", async () => {
    const repo = makeRepo();
    const fakes = makeFakeAgents({
      claude: `fs.mkdirSync(path.join(process.cwd(), ".claude/tsc-cache/s1"), { recursive: true }); write(".claude/tsc-cache/s1/edited-files.log", "x"); write("value.txt", "fixed\\n"); reply("ok");`,
      codex: APPROVE,
    });
    const env = { ...fakes.env, FUSION_CODEX_EXTRA_ARGS: '-c model_provider="openai"' };
    const warnings: string[] = [];
    const { report, runDir } = await runFusion(options(repo, fakes, { env }), { status: () => undefined, warn: (w) => warnings.push(w) });
    expect(report.files).toEqual(["value.txt"]);
    expect(readFileSync(join(runDir, "patch.diff"), "utf8")).not.toContain(".claude");
    expect(warnings.join("\n")).toContain(".claude/tsc-cache/s1/edited-files.log");
    const codexArgs = fakes.args("codex", 1).args;
    expect(codexArgs.slice(codexArgs.indexOf("-c"), codexArgs.indexOf("-c") + 3)).toEqual(["-c", 'model_provider="openai"', "--"]);
  });

  it("writer that changes nothing yields no-changes and skips verify and review", async () => {
    const repo = makeRepo();
    const fakes = makeFakeAgents({ claude: `reply("I could not find anything to change");` });
    const { report } = await runFusion(options(repo, fakes), silent);
    expect(report.status).toBe("no-changes");
    expect(report.verifications).toEqual([]);
    expect(fakes.calls("codex")).toBe(0);
  });

  it("warns about uncommitted changes and leaves them untouched", async () => {
    const repo = makeRepo();
    writeFileSync(join(repo, "value.txt"), "user-wip\n");
    writeFileSync(join(repo, "notes.txt"), "untracked\n");
    const fakes = makeFakeAgents({ claude: `write("value.txt", "fixed\\n"); reply("ok");`, codex: APPROVE });
    const warnings: string[] = [];
    const { report } = await runFusion(options(repo, fakes), { status: () => undefined, warn: (w) => warnings.push(w) });
    expect(report.status).toBe("ready");
    expect(warnings.join("\n")).toMatch(/uncommitted change\(s\); they are NOT included/);
    expect(readFileSync(join(repo, "value.txt"), "utf8")).toBe("user-wip\n");
    expect(readFileSync(join(repo, "notes.txt"), "utf8")).toBe("untracked\n");
    expect(sh(repo, "git", ["rev-parse", "--abbrev-ref", "HEAD"]).trim()).toBe("main");
  });

  it("auto-detects npm test and loudly warns when there is no verify gate", async () => {
    const repo = makeRepo();
    const fakes = makeFakeAgents({ claude: `write("value.txt", "fixed\\n"); reply("ok");`, codex: APPROVE });
    const warnings: string[] = [];
    const { verify: _drop, ...noVerify } = options(repo, fakes);
    const { report } = await runFusion(noVerify, { status: () => undefined, warn: (w) => warnings.push(w) });
    expect(report.verifyCommand).toBeNull();
    expect(report.verifySource).toBe("none");
    expect(warnings.join("\n")).toContain("NO VERIFY GATE");

    writeFileSync(join(repo, "package.json"), JSON.stringify({ scripts: { test: "node check.js" } }));
    sh(repo, "git", ["add", "package.json"]);
    sh(repo, "git", ["commit", "-q", "-m", "pkg"]);
    expect(await detectVerifyCommand(repo)).toBe("npm test");
    const detected = await runFusion(noVerify, silent);
    expect(detected.report).toMatchObject({ verifyCommand: "npm test", verifySource: "auto-detected", status: "ready" });

    writeFileSync(join(repo, "package.json"), JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }));
    expect(await detectVerifyCommand(repo)).toBeNull();
  });

  it("errors outside a git repository", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fusion-nogit-"));
    const fakes = makeFakeAgents({});
    await expect(runFusion(options(dir, fakes), silent)).rejects.toThrow(FusionError);
    await expect(runFusion(options(dir, fakes), silent)).rejects.toThrow(/not a git repository/);
    const r = await cli(["-C", dir, "list"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("not a git repository");
  });
});

describe("fusion cli: run, list, apply, discard, stats", () => {
  it("runs end to end through the CLI and manages the run", async () => {
    const repo = makeRepo();
    const fakes = makeFakeAgents({ claude: `write("value.txt", "fixed\\n"); reply("ok");`, codex: APPROVE });
    const env = { FUSION_CLAUDE_BIN: fakes.bins.claude, FUSION_CODEX_BIN: fakes.bins.codex, FAKE_STATE_DIR: fakes.stateDir };

    const run = await cli(["-C", repo, "run", "make value.txt say fixed", "--verify", "node check.js", "--yes", "--timeout", "20"], env);
    expect(run.code).toBe(0);
    expect(run.out).toMatch(/Status\s+READY/);
    expect(run.out).toMatch(/Verify\s+PASS\s+node check.js/);
    expect(run.out).toMatch(/Reviewer\s+codex\s+APPROVE/);
    expect(run.out).toContain("fusion apply");
    expect(run.err).toContain("running");

    const list = await cli(["-C", repo, "list"]);
    expect(list.code).toBe(0);
    expect(list.out).toMatch(/ready\s+claude>codex\s+PASS\s+approve\s+1\s+no/);

    expect(readFileSync(join(repo, "value.txt"), "utf8")).toBe("bug\n");
    const apply = await cli(["-C", repo, "apply", "latest"]);
    expect(apply.code).toBe(0);
    expect(readFileSync(join(repo, "value.txt"), "utf8")).toBe("fixed\n");
    expect(sh(repo, "git", ["log", "--oneline"]).trim().split("\n")).toHaveLength(1);

    const stats = await cli(["-C", repo, "stats"]);
    expect(stats.out).toMatch(/claude\s+1\s+100% \(1\/1\)\s+100% \(1\/1\)\s+100% \(1\/1\)\s+0\.00\s+0\.00\s+1/);

    const discard = await cli(["-C", repo, "discard", "latest"]);
    expect(discard.code).toBe(0);
    expect((await cli(["-C", repo, "list"])).out).toContain("no runs yet");
    expect(sh(repo, "git", ["worktree", "list"]).trim().split("\n")).toHaveLength(1);
    expect((await readLedger(repo))[0]?.applied).toBe(true);
  });

  it("refuses to apply a missing or empty patch and rejects path-like ids", async () => {
    const repo = makeRepo();
    const fakes = makeFakeAgents({ claude: `reply("nothing");` });
    await runFusion(options(repo, fakes), silent);
    const empty = await cli(["-C", repo, "apply", "latest"]);
    expect(empty.code).toBe(2);
    expect(empty.err).toContain("empty patch");
    const missing = await cli(["-C", repo, "apply", "20990101-000000-abcd"]);
    expect(missing.code).toBe(2);
    expect(missing.err).toContain("no patch.diff");
    const escape = await cli(["-C", repo, "discard", "../../etc"]);
    expect(escape.code).toBe(2);
    expect(escape.err).toContain("invalid run id");
  });

  it("rejects bad run arguments", async () => {
    const repo = makeRepo();
    expect((await cli(["-C", repo, "run", "--yes"])).code).toBe(2);
    expect((await cli(["-C", repo, "run", "x", "--writer", "gpt", "--yes"])).code).toBe(2);
    expect((await cli(["-C", repo, "run", "x", "--repairs", "5", "--yes"], { FUSION_CLAUDE_BIN: "/bin/true", FUSION_CODEX_BIN: "/bin/true" })).code).toBe(2);
  });
});

describe("parseReview", () => {
  it("accepts bare, fenced, and embedded JSON", () => {
    expect(parseReview('{"verdict":"approve","blocking":[],"suggestions":[]}')).toMatchObject({ status: "ok", verdict: "approve" });
    expect(parseReview('Sure.\n```json\n{"verdict":"changes","blocking":[{"file":"a.js","issue":"bug"}]}\n```')).toMatchObject({ status: "ok", verdict: "changes" });
    expect(parseReview('Result: {"verdict":"approve","blocking":[],"suggestions":["x {y}"]} done')).toMatchObject({ status: "ok", suggestions: ["x {y}"] });
  });

  it("never approves when blocking findings exist or the output is unusable", () => {
    expect(parseReview('{"verdict":"approve","blocking":[{"file":"a","issue":"real bug"}]}')).toMatchObject({ verdict: "changes" });
    expect(parseReview('{"verdict":"changes","blocking":[]}')).toMatchObject({ verdict: "changes", blocking: [expect.anything()] });
    expect(parseReview("LGTM")).toMatchObject({ status: "unavailable" });
    expect(parseReview("")).toMatchObject({ status: "unavailable" });
    expect(parseReview('{"verdict":"maybe"}')).toMatchObject({ status: "unavailable" });
  });
});
