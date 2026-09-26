# Architecture

Milestone 0 components exist under `src/`. Everything marked "planned" below
has no code yet.

| Module | Component | Status |
| --- | --- | --- |
| `src/schemas` | Versioned contracts (task, policy, adapter, plan, ledger) | implemented |
| `src/policy` | Static policy engine and default rules | implemented |
| `src/adapters` | Claude Code and Codex adapter contracts, see [docs/CLI_CONTRACTS.md](docs/CLI_CONTRACTS.md) | invocation planning and output parsing only |
| `src/planner` | Dry-run plan builder, renderer, invariants | implemented |
| `src/ledger` | Ledger construction and redacting serializer | implemented |
| `src/progress` | Leg state machine (`TRANSITIONS`), stream validator, dry-run simulator | implemented |
| `src/cli` | `inseat-fusion plan`, `simulate`, and `validate-events` | implemented |
| process supervisor, worktree isolation, verifier, evidence judge, bounded repair, atomic applicator | planned | Milestone 1+ |

Toolchain: Node.js 22+, TypeScript 5 (`NodeNext` ESM), Zod 4, Vitest.

## Invariants

1. Solvers operate in separate worktrees derived from one immutable base.
2. Critics are read-only and receive only the material needed for review.
3. Cancellation, timeout, failed validation, or process failure leaves the base
   worktree unchanged.
4. A workflow selects one candidate; it never performs an unsafe automatic
   textual merge of multiple candidates.
5. At most one policy-bounded repair precedes final verification.
6. Only the atomic applicator can mutate the base, and only after all gates pass.
7. Every leg has explicit budgets, timeouts, provenance, and an observable state.

## Progress events

Each leg moves through `planned -> ready -> running -> <terminal>`, where terminal
is one of `succeeded`, `failed`, `timed-out`, `cancelled`, `budget-exhausted`,
`malformed-output`, `schema-drift`. `planned` and `ready` may also go straight to
`cancelled`. Nothing follows a terminal state. A `ProgressStream` is valid only
when sequence numbers are contiguous from 0, timestamps never regress, every
leg's first event is `planned`, every transition is in the table, and every
event shares the stream's `workflowId` and `origin`.

`origin` is either `dry-run-simulation` or `runtime`. Only the former exists
today. The dry-run plan embeds the state table under `progressModel` as a
specification for a future runtime; it never contains simulated events.

## Planned components

### CLI and configuration

Parses task intent, repository target, static policy, allowed adapters, model
bindings, verification rules, budgets, timeouts, and credential references. A
dry-run mode renders the complete plan without launching a provider process.

### Adapter interface

Normalizes documented Claude Code and Codex noninteractive interfaces behind a
small contract: capability declaration, invocation plan, structured progress,
result envelope, usage evidence, cancellation, and normalized failure. Adapters
must not hide provider-specific limitations or invent missing usage data.

### Process supervisor

Starts each allowed CLI as a child process, streams bounded output, enforces
deadlines, propagates cancellation, captures exit state, and removes isolated
resources. It never places credentials in logs or command summaries.

### Worktree isolation

Creates a solver worktree from a pinned immutable base and rejects path escape,
unexpected symlinks, base drift, and writes outside the assigned root. Parallel
candidates, if later implemented, receive separate worktrees from the same base.

### Policy engine

The MVP uses explicit static rules to choose Single, Cascade, or Critique. Inputs
and the selected rule are recorded. A learned policy is deferred until static
evaluation, data governance, rollback, and interpretability requirements exist.

### Deterministic verifier

Runs allowlisted checks against a candidate and emits structured pass, fail, or
unavailable evidence. It enforces patch scope, base revision, output schema, and
configured repository checks independently of model opinion.

### Evidence judge

Ranks only candidates that passed mandatory deterministic gates. It receives
normalized evidence, not authority to edit files. Judge output is advisory and
auditable; ambiguity or invalid output fails closed.

### Bounded repair

Returns specific failed evidence to the selected solver for at most one repair
when the policy permits it. The repaired candidate must pass the full verifier,
not only the previously failed check.

### Atomic applicator

Confirms that the base revision is unchanged, validates patch paths and symlink
behavior again, applies one selected patch transactionally, and verifies the
result. Any failure restores the pre-application state without publishing a
partial change.

### Ledger

Records workflow ID, policy decision, immutable base, adapter and model identity,
leg role, timestamps, latency, usage and cost evidence, budgets, process outcome,
verification evidence, repair count, selected candidate, and application result.
Secret values and raw credential material are never ledger fields.

## Planned flow

1. Validate configuration, repository state, adapters, budgets, and policy.
2. Render the plan and obtain any required user approval.
3. Pin the immutable base and create isolated solver worktrees.
4. Execute Single, Cascade, or Critique under the process supervisor.
5. Verify candidates and collect normalized evidence.
6. Select one passing candidate; optionally permit one bounded repair.
7. Reverify the complete candidate.
8. Atomically apply one final patch if the base is unchanged.
9. Finalize the ledger and show progress, provenance, cost, and latency evidence.

## Credentials and provider boundary

Users supply their own API keys or authenticated CLI credentials under each
provider's terms. The controller passes only the minimum references needed by
the local CLI. It does not resell credentials, operate a credential proxy, or
claim provider affiliation.
