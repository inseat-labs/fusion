import { z } from "zod";
import type { AdapterCapabilities, ResultEnvelope } from "../../schemas/adapter.js";
import { CLI_DEFAULT_MODEL, type Adapter, type InvocationRequest } from "../types.js";

export const claudeCodeCapabilities: AdapterCapabilities = {
  adapter: "claude-code",
  cliName: "claude",
  noninteractiveFlag: "-p",
  structuredOutput: "json",
  supportsReadOnlyMode: true,
  supportsModelSelection: true,
  reportsUsage: true,
  documentationUrl: "https://code.claude.com/docs/en/headless",
  documentationCheckedOn: "2026-09-19",
};

const READ_ONLY_TOOLS = "Read,Grep,Glob";

const ERROR_SUBTYPES = [
  "error_max_turns",
  "error_during_execution",
  "error_max_budget_usd",
  "error_max_structured_output_retries",
] as const;

const UsageBlock = z.object({
  input_tokens: z.number().int().nonnegative().optional(),
  output_tokens: z.number().int().nonnegative().optional(),
  cache_creation_input_tokens: z.number().int().nonnegative().nullable().optional(),
  cache_read_input_tokens: z.number().int().nonnegative().nullable().optional(),
});

const ResultMessage = z.object({
  type: z.literal("result"),
  subtype: z.union([z.literal("success"), z.enum(ERROR_SUBTYPES)]),
  is_error: z.boolean().optional(),
  result: z.string().optional(),
  errors: z.array(z.string()).optional(),
  session_id: z.string().optional(),
  terminal_reason: z.string().optional(),
  total_cost_usd: z.number().nonnegative().optional(),
  usage: UsageBlock.optional(),
  modelUsage: z.record(z.string(), z.unknown()).optional(),
  permission_denials: z.array(z.unknown()).optional(),
});

export const claudeCodeAdapter: Adapter = {
  capabilities: claudeCodeCapabilities,

  planInvocation(request: InvocationRequest) {
    const args = ["-p", request.instruction, "--output-format", "json"];
    if (request.binding.model !== CLI_DEFAULT_MODEL) args.push("--model", request.binding.model);
    if (request.readOnly) {
      args.push("--permission-mode", "dontAsk", "--tools", READ_ONLY_TOOLS, "--allowedTools", READ_ONLY_TOOLS);
    } else {
      args.push("--permission-mode", "acceptEdits");
    }
    if (request.maxUsd !== undefined) {
      args.push("--max-budget-usd", String(request.maxUsd));
    }
    return {
      adapter: "claude-code",
      executable: "claude",
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
      adapter: "claude-code" as const,
      model: null,
      exitCode,
      providerRef: null,
      terminalReason: null,
      changedFiles: [] as string[],
      warnings: [] as string[],
    };
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return { ...base, outcome: "malformed-output", summary: "stdout was not valid JSON", usage: unavailable("output unparseable"), rawKind: "text" };
    }
    const parsed = ResultMessage.safeParse(json);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return {
        ...base,
        outcome: "schema-drift",
        summary: `result message did not match the documented shape at ${issue?.path.join(".") || "<root>"}: ${issue?.message ?? "unknown"}`,
        usage: unavailable("shape mismatch"),
        rawKind: "json",
      };
    }
    const r = parsed.data;
    const warnings: string[] = [];
    const modelKeys = r.modelUsage ? Object.keys(r.modelUsage) : [];
    const model = modelKeys.length === 1 ? (modelKeys[0] ?? null) : null;
    if (modelKeys.length > 1) warnings.push(`modelUsage lists ${modelKeys.length} models; model identity left null`);
    if ((r.permission_denials?.length ?? 0) > 0) warnings.push(`${r.permission_denials!.length} permission denial(s) recorded`);

    const usage =
      r.usage || r.total_cost_usd !== undefined
        ? {
            status: "reported" as const,
            inputTokens: r.usage?.input_tokens,
            cachedInputTokens: r.usage?.cache_read_input_tokens ?? undefined,
            outputTokens: r.usage?.output_tokens,
            costUsd: r.total_cost_usd,
            costIsEstimate: r.total_cost_usd !== undefined ? true : undefined,
            source: "claude --output-format json result.usage/total_cost_usd (client-side estimate)",
          }
        : unavailable("usage and total_cost_usd absent");

    const outcome = classify(r.subtype, r.is_error, r.terminal_reason);
    const summary = r.result ?? (r.errors && r.errors.length > 0 ? r.errors.join("; ") : r.subtype);

    return {
      ...base,
      model,
      providerRef: r.session_id ?? null,
      terminalReason: r.terminal_reason ?? null,
      outcome,
      summary,
      usage,
      rawKind: "json",
      warnings,
    };
  },
};

function classify(subtype: string, isError: boolean | undefined, terminalReason: string | undefined): ResultEnvelope["outcome"] {
  if (subtype === "error_max_budget_usd" || terminalReason === "budget_exhausted") return "budget-exhausted";
  if (subtype !== "success" || isError === true) return "failed";
  return "succeeded";
}

function unavailable(reason: string) {
  return { status: "unavailable" as const, reason };
}
