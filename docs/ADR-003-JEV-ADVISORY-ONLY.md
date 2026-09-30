# ADR-003: Jev is advisory-only, optional, and not yet integrated

## Status

Accepted 2026-09-19. Decision record only. No code, dependency, configuration
flag, or network call related to Jev exists in this repository.

## Context

The AGNTCon research (September 2026) raised whether a hosted probabilistic
decision model could help Fusion make judgment calls. Jev, from TypeSafe,
is the candidate under discussion. This record fixes what Jev is, what it is
not, and the conditions under which it could ever be wired in.

### What the official documentation says (reviewed 2026-09-19)

Source: https://docs.typesafe.ai/

- Jev is "TypeSafe's flagship model and the first System One model". System One
  models "are built to make fast, structured decisions that software can use
  directly".
- Input is state plus typed questions. Question types are Choice ("choose an
  option from a list"), Score ("score the state on a rubric"), and Noul ("is
  this statement true?"). Types can be mixed in one call.
- Choice returns `choice`, `probabilities`, `confidence`. Score returns
  `score`, `probabilities`, `confidence`. Noul returns `noul` in [0, 1].
- The docs page reviewed does not state the endpoint, model id, context window,
  latency, pricing, access status, SDK names, data retention, or privacy terms.

### What third-party sources say (unverified against TypeSafe)

- Endpoint `POST https://api.typesafe.ai/v1/systemone`, model id `jev-latest`,
  Python and JavaScript SDKs, early access behind a waitlist as of 2026-09-15.
- Listed on OpenRouter as `typesafe/jev-1.13` with a 32k context window and
  usage-based pricing, and on Vercel AI Gateway.

Sources: https://openrouter.ai/typesafe/jev-1.13 ,
https://vercel.com/changelog/typesafe-ai-jev-now-available-on-ai-gateway ,
https://www.developersdigest.tech/blog/typesafe-jev-system-one-models-release-guide-2026

These figures must be re-verified against TypeSafe before any implementation.

## Decision

1. **Jev is a hosted probabilistic decision model.** Its outputs are typed
   choices, scores, and truth estimates with probabilities. They are
   predictions, not measurements.
2. **Jev is not an MCP server and not an agent runtime.** It does not execute
   tools, run processes, hold repository state, or orchestrate anything. It
   answers questions about state that the caller supplies.
3. **Jev does not replace deterministic checks, process isolation,
   verification, or provenance.** Solver isolation in worktrees, read-only critics, deterministic gates, atomic application, the ledger, progress-stream validation, and the boundary-lineage envelopes in `BOUNDARY_LINEAGE.md` are all unaffected by whether an advisory provider exists.
4. **Jev may later serve as an optional advisory decision provider.** The only
   admissible uses are advisory: ranking already-verified candidates, flagging a
   case for human review, or suggesting which check to run first. Advisory
   output is recorded as advice, labeled with its provider and confidence, and
   never changes a deterministic result.
5. **Disabled by default.** Enabling requires an explicit configuration value
   and an explicit credential supplied by the user. Absence of either means the
   provider is not constructed.
6. **No automatic transmission of source code, secrets, or raw traces.** A
   decision provider receives only a redacted, schema-constrained
   `DecisionInput` that the user's configuration has allowlisted. The default
   allowlist is empty.
7. **Low confidence produces abstention or human review.** Below a configured
   threshold the provider result is `abstain`. Callers must treat `abstain`
   exactly as they treat "no provider configured".
8. **A Jev result cannot override a deterministic failure.** If a
   deterministic check, verifier, gate, or lineage validation fails, the
   workflow result is failure regardless of any advisory output.
9. **No Jev SDK dependency and no live API call is added now.** Not in
   `package.json`, not in CI, not in fixtures.

## Future interface (conceptual, not implemented)

```ts
interface DecisionInput {
  version: 1;
  kind: "choice" | "score" | "boolean";
  question: string;
  options?: string[];
  state: Record<string, unknown>;
  redaction: "allowlisted-fields";
}

type DecisionResult =
  | { kind: "choice"; choice: string; confidence: number; provider: string }
  | { kind: "score"; score: number; confidence: number; provider: string }
  | { kind: "boolean"; value: boolean; confidence: number; provider: string }
  | { kind: "abstain"; reason: string; provider: string };

interface DecisionProvider {
  readonly id: string;
  decide(input: DecisionInput): Promise<DecisionResult>;
}
```

A `NullDecisionProvider` that always returns `abstain` would be the default and
the only provider shipped until the conditions below are met.

## Conditions before any implementation

- TypeSafe publishes terms covering data retention and training use, and they
  are acceptable for user-supplied redacted state.
- A written data-flow diagram shows exactly which fields can leave the machine.
- Tests prove that `abstain` and provider errors are indistinguishable from
  "not configured" in every code path.
- Tests prove that no advisory result can flip a `fail` or `not-tested`.
- The feature is reviewed against the threat model.

## Consequences

Deterministic behavior remains the product. Advisory decisions, if they ever
arrive, are an optional layer whose removal changes nothing about correctness.
