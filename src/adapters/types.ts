import type { AdapterCapabilities, InvocationPlan, ResultEnvelope } from "../schemas/adapter.js";
import type { ModelBinding } from "../schemas/common.js";

/** Binding model value that omits `--model` so the CLI uses its own configured default. */
export const CLI_DEFAULT_MODEL = "default";

export interface InvocationRequest {
  binding: ModelBinding;
  instruction: string;
  cwd: string;
  readOnly: boolean;
  timeoutSeconds: number;
  maxUsd?: number;
}

export interface Adapter {
  readonly capabilities: AdapterCapabilities;
  planInvocation(request: InvocationRequest): InvocationPlan;
  parseOutput(raw: string, exitCode: number | null): ResultEnvelope;
}
