import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const GIT_ENV = {
  GIT_AUTHOR_NAME: "fusion-test",
  GIT_AUTHOR_EMAIL: "fusion-test@example.invalid",
  GIT_COMMITTER_NAME: "fusion-test",
  GIT_COMMITTER_EMAIL: "fusion-test@example.invalid",
};

export function sh(cwd: string, cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", env: { ...process.env, ...GIT_ENV } });
}

/** A temp git repo with one committed file `value.txt` = "bug" and a `check.js` that passes when it reads "fixed". */
export function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "fusion-repo-"));
  sh(dir, "git", ["init", "-q", "-b", "main"]);
  writeFileSync(join(dir, "value.txt"), "bug\n");
  writeFileSync(
    join(dir, "check.js"),
    `const v = require("fs").readFileSync("value.txt", "utf8").trim();\nif (v !== "fixed") { console.error("expected fixed, got " + v); process.exit(1); }\nconsole.log("ok");\n`,
  );
  sh(dir, "git", ["add", "-A"]);
  sh(dir, "git", ["commit", "-q", "-m", "init"]);
  return dir;
}

const PRELUDE = `#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const args = process.argv.slice(2);
const stateDir = process.env.FAKE_STATE_DIR;
const counterFile = path.join(stateDir, KIND + "-calls");
const call = (fs.existsSync(counterFile) ? Number(fs.readFileSync(counterFile, "utf8")) : 0) + 1;
fs.writeFileSync(counterFile, String(call));
fs.writeFileSync(path.join(stateDir, KIND + "-args-" + call + ".json"), JSON.stringify({ args, cwd: process.cwd() }));
const write = (file, text) => fs.writeFileSync(path.join(process.cwd(), file), text);
`;

const CLAUDE_HELPERS = `
const prompt = args[args.indexOf("-p") + 1];
const readOnly = args.includes("dontAsk");
const reply = (text) => process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: text, session_id: "fake", total_cost_usd: 0.01, usage: { input_tokens: 1, output_tokens: 1 } }));
`;

const CODEX_HELPERS = `
const prompt = args[args.length - 1];
const readOnly = args.includes("read-only");
const reply = (text) => {
  const lines = [
    { type: "thread.started", thread_id: "fake-thread" },
    { type: "item.completed", item: { id: "i1", type: "agent_message", text } },
    { type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } },
  ];
  process.stdout.write(lines.map((l) => JSON.stringify(l)).join("\\n") + "\\n");
};
`;

export interface FakeAgents {
  stateDir: string;
  bins: { claude: string; codex: string };
  env: NodeJS.ProcessEnv;
  calls(kind: "claude" | "codex"): number;
  args(kind: "claude" | "codex", call: number): { args: string[]; cwd: string };
}

/** Bodies are JS with `prompt`, `readOnly`, `call`, `write(file, text)`, and `reply(text)` in scope. */
export function makeFakeAgents(bodies: { claude?: string; codex?: string }): FakeAgents {
  const stateDir = mkdtempSync(join(tmpdir(), "fusion-fake-"));
  const bins = { claude: join(stateDir, "claude"), codex: join(stateDir, "codex") };
  const script = (kind: "claude" | "codex", helpers: string, body: string) => {
    writeFileSync(bins[kind], PRELUDE.replace(/KIND/g, JSON.stringify(kind)) + helpers + body + "\n");
    chmodSync(bins[kind], 0o755);
  };
  script("claude", CLAUDE_HELPERS, bodies.claude ?? `reply("nothing to do");`);
  script("codex", CODEX_HELPERS, bodies.codex ?? `reply(JSON.stringify({ verdict: "approve", blocking: [], suggestions: [] }));`);
  return {
    stateDir,
    bins,
    env: { ...process.env, ...GIT_ENV, FAKE_STATE_DIR: stateDir },
    calls: (kind) => {
      const f = join(stateDir, `${kind}-calls`);
      return existsSync(f) ? Number(readFileSync(f, "utf8")) : 0;
    },
    args: (kind, call) => JSON.parse(readFileSync(join(stateDir, `${kind}-args-${call}.json`), "utf8")),
  };
}

export const APPROVE = `reply(JSON.stringify({ verdict: "approve", blocking: [], suggestions: ["consider a comment"] }));`;
