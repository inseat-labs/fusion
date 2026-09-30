import { z } from "zod";
import type { AdapterCapabilities, ResultEnvelope } from "../../schemas/adapter.js";
import { CLI_DEFAULT_MODEL, type Adapter, type InvocationRequest } from "../types.js";

export const codexCapabilities: AdapterCapabilities = {
  adapter: "codex",
  cliName: "codex",
  noninteractiveFlag: "exec",
  structuredOutput: "json-stream",
  supportsReadOnlyMode: true,
  supportsModelSelection: true,
  reportsUsage: true,
  documentationUrl: "https://learn.chatgpt.com/docs/non-interactive-mode",
  documentationCheckedOn: "2026-09-19",
};

const Usage = z.object({
  input_tokens: z.number().int().nonnegative().optional(),
  cached_input_tokens: z.number().int().nonnegative().optional(),
  cache_write_input_tokens: z.number().int().nonnegative().optional(),
  output_tokens: z.number().int().nonnegative().optional(),
  reasoning_output_tokens: z.number().int().nonnegative().optional(),
});

const AnyEvent = z.object({ type: z.string() }).passthrough();
const TurnCompleted = z.object({ type: z.literal("turn.completed"), usage: Usage.optional() });
const TurnFailed = z.object({ type: z.literal("turn.failed"), error: z.object({ message: z.string() }) });
const ThreadError = z.object({ type: z.literal("error"), message: z.string() });
const ThreadStarted = z.object({ type: z.literal("thread.started"), thread_id: z.string() });
const ItemCompleted = z.object({
  type: z.literal("item.completed"),
  item: z
    .object({
      id: z.string(),
      type: z.string(),
      text: z.string().optional(),
      changes: z.array(z.object({ path: z.string(), kind: z.string().optional() })).optional(),
      status: z.string().optional(),
    })
    .passthrough(),
});

export const codexAdapter: Adapter = {
  capabilities: codexCapabilities,

  planInvocation(request: InvocationRequest) {
    const args = ["exec", "--json"];
    if (request.binding.model !== CLI_DEFAULT_MODEL) args.push("--model", request.binding.model);
    args.push("--sandbox", request.readOnly ? "read-only" : "workspace-write");
    args.push("--", request.instruction);
    return {
      adapter: "codex",
      executable: "codex",
      args,
      cwd: request.cwd,
      readOnly: request.readOnly,
      credentialSource: "user-cli-login",
      timeoutSeconds: request.timeoutSeconds,
    };
  },

  parseOutput(raw: string, exitCode: number | null): ResultEnvelope {
    const base = {
      version: 1 as const,
      adapter: "codex" as const,
      model: null,
      exitCode,
      providerRef: null,
      terminalReason: null,
      changedFiles: [] as string[],
      warnings: [] as string[],
      rawKind: "jsonl",
    };
    const lines = raw.split("\n").filter((l) => l.trim() !== "");
    if (lines.length === 0) {
      return { ...base, outcome: "malformed-output", summary: "no output lines", usage: unavailable("empty output") };
    }
    const events: unknown[] = [];
    for (const line of lines) {
      try {
        events.push(JSON.parse(line));
      } catch {
        return { ...base, outcome: "malformed-output", summary: "a JSONL line was not valid JSON", usage: unavailable("output unparseable") };
      }
    }
    if (!events.every((e) => AnyEvent.safeParse(e).success)) {
      return { ...base, outcome: "schema-drift", summary: "an event lacked a string `type` field", usage: unavailable("shape mismatch") };
    }

    const threadId = first(events, ThreadStarted)?.thread_id ?? null;
    const items = events.map((e) => ItemCompleted.safeParse(e)).filter((r) => r.success).map((r) => r.data.item);
    const lastMessage = [...items].reverse().find((i) => i.type === "agent_message")?.text;
    const changedFiles = [...new Set(items.filter((i) => i.type === "file_change").flatMap((i) => (i.changes ?? []).map((c) => c.path)))];
    const failed = first(events, TurnFailed);
    const errors = events.map((e) => ThreadError.safeParse(e)).filter((r) => r.success).map((r) => r.data.message);
    const threadError = errors.length > 0 ? { message: errors.at(-1)! } : undefined;
    const completed = first(events, TurnCompleted);

    // Codex emits `error` events for retried transport failures ("Reconnecting... 1/5"); only fatal if the turn never completed.
    if (failed || (threadError && !completed)) {
      return {
        ...base,
        providerRef: threadId,
        terminalReason: failed ? "turn.failed" : "error",
        outcome: "failed",
        summary: failed?.error.message ?? threadError?.message ?? "turn failed",
        changedFiles,
        usage: completed?.usage ? reported(completed.usage) : unavailable("turn did not complete with usage"),
      };
    }
    if (!completed) {
      return {
        ...base,
        providerRef: threadId,
        outcome: "failed",
        summary: lastMessage ?? "stream ended without turn.completed",
        changedFiles,
        usage: unavailable("turn.completed event absent"),
      };
    }
    const warnings = errors.map((m) => `transient error event: ${m}`);
    if (exitCode !== null && exitCode !== 0) warnings.push(`turn.completed observed but exit code was ${exitCode}`);
    return {
      ...base,
      providerRef: threadId,
      terminalReason: "turn.completed",
      outcome: exitCode === 0 || exitCode === null ? "succeeded" : "failed",
      summary: lastMessage ?? "turn completed",
      changedFiles,
      usage: completed.usage ? reported(completed.usage) : unavailable("turn.completed had no usage"),
      warnings,
    };
  },
};

function first<T extends z.ZodTypeAny>(events: unknown[], schema: T): z.infer<T> | undefined {
  for (const e of events) {
    const r = schema.safeParse(e);
    if (r.success) return r.data;
  }
  return undefined;
}

function reported(u: z.infer<typeof Usage>) {
  return {
    status: "reported" as const,
    inputTokens: u.input_tokens,
    cachedInputTokens: u.cached_input_tokens,
    outputTokens: u.output_tokens,
    reasoningOutputTokens: u.reasoning_output_tokens,
    source: "codex exec --json turn.completed.usage (no cost field is emitted)",
  };
}

function unavailable(reason: string) {
  return { status: "unavailable" as const, reason };
}
