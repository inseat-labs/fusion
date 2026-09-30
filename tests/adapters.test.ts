import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { claudeCodeAdapter } from "../src/adapters/claude-code/index.js";
import { codexAdapter } from "../src/adapters/codex/index.js";
import { ResultEnvelopeSchema } from "../src/schemas/adapter.js";

const dir = join(import.meta.dirname, "..", "fixtures", "adapters");
const load = (adapter: string, file: string) => readFile(join(dir, adapter, file), "utf8");

describe("claude-code adapter", () => {
  it("plans a read-only critic invocation that denies prompts and restricts tools", () => {
    const plan = claudeCodeAdapter.planInvocation({ binding: { adapter: "claude-code", model: "m" }, instruction: "review", cwd: "/w", readOnly: true, timeoutSeconds: 10 });
    expect(plan.readOnly).toBe(true);
    expect(plan.args).toContain("dontAsk");
    expect(plan.args).toContain("--tools");
    expect(plan.args).toContain("--allowedTools");
    expect(plan.args).not.toContain("acceptEdits");
    expect(plan.credentialSource).toBe("user-cli-login");
  });

  it("passes --max-budget-usd only when a budget is given", () => {
    const req = { binding: { adapter: "claude-code" as const, model: "m" }, instruction: "x", cwd: "/w", readOnly: false, timeoutSeconds: 10 };
    expect(claudeCodeAdapter.planInvocation(req).args).not.toContain("--max-budget-usd");
    const withBudget = claudeCodeAdapter.planInvocation({ ...req, maxUsd: 2.5 }).args;
    expect(withBudget[withBudget.indexOf("--max-budget-usd") + 1]).toBe("2.5");
  });

  it.each([
    ["success.json", "succeeded", "reported"],
    ["error.json", "failed", "reported"],
    ["budget-exhausted.json", "budget-exhausted", "reported"],
    ["permission-denied.json", "succeeded", "reported"],
    ["missing-usage.json", "succeeded", "unavailable"],
    ["malformed.txt", "malformed-output", "unavailable"],
    ["schema-drift.json", "schema-drift", "unavailable"],
  ])("%s -> %s / usage %s", async (file, outcome, usage) => {
    const env = claudeCodeAdapter.parseOutput(await load("claude-code", file), 0);
    expect(ResultEnvelopeSchema.parse(env)).toBeTruthy();
    expect(env.outcome).toBe(outcome);
    expect(env.usage.status).toBe(usage);
  });

  it("extracts session id, terminal reason, model, and marks cost as an estimate", async () => {
    const env = claudeCodeAdapter.parseOutput(await load("claude-code", "success.json"), 0);
    expect(env.providerRef).toBe("sess_synthetic_001");
    expect(env.terminalReason).toBe("completed");
    expect(env.model).toBe("claude-opus-5");
    expect(env.usage).toMatchObject({ status: "reported", costUsd: 0.0412, costIsEstimate: true, cachedInputTokens: 1200 });
  });

  it("surfaces errors[] as the summary and warns about permission denials", async () => {
    const err = claudeCodeAdapter.parseOutput(await load("claude-code", "error.json"), 1);
    expect(err.summary).toContain("Reached max turns");
    const denied = claudeCodeAdapter.parseOutput(await load("claude-code", "permission-denied.json"), 0);
    expect(denied.warnings.some((w) => w.includes("permission denial"))).toBe(true);
  });
});

describe("codex adapter", () => {
  it("plans a read-only sandbox for critics", () => {
    const plan = codexAdapter.planInvocation({ binding: { adapter: "codex", model: "m" }, instruction: "review", cwd: "/w", readOnly: true, timeoutSeconds: 10 });
    expect(plan.args).toContain("read-only");
    expect(plan.args[0]).toBe("exec");
  });

  it.each([
    ["success.jsonl", "succeeded", "reported"],
    ["turn-failed.jsonl", "failed", "unavailable"],
    ["thread-error.jsonl", "failed", "unavailable"],
    ["incomplete.jsonl", "failed", "unavailable"],
    ["missing-usage.jsonl", "succeeded", "unavailable"],
    ["malformed.jsonl", "malformed-output", "unavailable"],
    ["schema-drift.jsonl", "schema-drift", "unavailable"],
  ])("%s -> %s / usage %s", async (file, outcome, usage) => {
    const env = codexAdapter.parseOutput(await load("codex", file), 0);
    expect(ResultEnvelopeSchema.parse(env)).toBeTruthy();
    expect(env.outcome).toBe(outcome);
    expect(env.usage.status).toBe(usage);
  });

  it("extracts thread id, changed files, and reasoning tokens", async () => {
    const env = codexAdapter.parseOutput(await load("codex", "success.jsonl"), 0);
    expect(env.providerRef).toBe("thr_synthetic_001");
    expect(env.changedFiles).toEqual(["src/paginate.ts", "tests/paginate.test.ts"]);
    expect(env.usage).toMatchObject({ status: "reported", reasoningOutputTokens: 96, cachedInputTokens: 1500 });
    expect("costUsd" in env.usage).toBe(false);
  });

  it("uses the turn.failed message as the summary", async () => {
    const env = codexAdapter.parseOutput(await load("codex", "turn-failed.jsonl"), 1);
    expect(env.summary).toContain("rate limit");
    expect(env.terminalReason).toBe("turn.failed");
  });

  it("treats retried 'Reconnecting' error events as warnings when the turn completes", async () => {
    const env = codexAdapter.parseOutput(await load("codex", "reconnect-then-success.jsonl"), 0);
    expect(env.outcome).toBe("succeeded");
    expect(env.summary).toContain('"verdict":"approve"');
    expect(env.warnings[0]).toContain("Reconnecting... 1/5");
  });

  it("reports the last error message when retries are exhausted", async () => {
    const env = codexAdapter.parseOutput(await load("codex", "reconnect-exhausted.jsonl"), 1);
    expect(env.outcome).toBe("failed");
    expect(env.summary).toBe("unexpected status 403 Forbidden: Free tier users do not have access to this model.");
  });

  it("separates flags from the prompt with -- and omits --model for the CLI default", () => {
    const plan = codexAdapter.planInvocation({ binding: { adapter: "codex", model: "default" }, instruction: "--looks-like-a-flag", cwd: "/w", readOnly: false, timeoutSeconds: 10 });
    expect(plan.args).toEqual(["exec", "--json", "--sandbox", "workspace-write", "--", "--looks-like-a-flag"]);
  });

  it("never invents usage numbers when they are absent", async () => {
    const env = codexAdapter.parseOutput(await load("codex", "missing-usage.jsonl"), 0);
    expect(env.usage).toEqual({ status: "unavailable", reason: "turn.completed had no usage" });
  });
});
