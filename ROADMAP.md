# Roadmap

All milestones are proposals. Advancement depends on security review and the
preregistered evaluation in [docs/EVALUATION_PLAN.md](docs/EVALUATION_PLAN.md).

## Milestone 0: contracts and dry-run planning

Status: complete as of 2026-09-19. Adapter contracts revalidated
(docs/CLI_CONTRACTS.md); progress-event schema, validator, and fixture-driven
cancellation, timeout, and budget-exhaustion simulations added.

- Freeze task, policy, adapter, event, budget, and ledger schemas.
- Implement static policy selection and explain every selected workflow leg.
- Define Claude Code and Codex adapter contract fixtures without live calls.
- Produce user-visible dry-run plans with estimated limits, not invented costs.
- Validate cancellation, schema drift, and malformed output fixtures.

Exit criterion: deterministic fixtures produce stable plans and provenance with
no process execution or repository mutation.

## Milestone 1: isolated Single workflow

Status: largely shipped as `fusion run` (Unreleased). One writer runs in a
detached worktree from `HEAD`, the user's verify command gates it, the process
supervisor enforces per-step timeouts on the whole process group, and the base
worktree is never modified. Application is the user's explicit `apply`
(`git apply --3way`). Still open: boundary-lineage envelopes, a base-drift
check before apply, and fault-injection tests for cancellation cleanup.
Verified with one real Claude Code writer + Codex reviewer run on 2026-09-30
(README "Real demo").

Lineage: emit `version: 1` boundary envelopes for `base -> solver -> verify ->
apply` per [docs/BOUNDARY_LINEAGE.md](docs/BOUNDARY_LINEAGE.md), with digest
continuity checked before atomic application.

- Add a process supervisor with explicit timeout, budget, and cancellation.
- Run one solver in a separate worktree created from an immutable base revision.
- Add deterministic verification and atomic application of one final patch.
- Leave the base unchanged on failure, timeout, cancellation, or failed checks.

Exit criterion: fault-injection tests establish atomicity and cleanup behavior.

## Milestone 2: Cascade and Critique

Status: Critique with bounded repair is shipped in `run` (cross-vendor read-only
reviewer, up to two repairs, re-verify and re-review after each). Per-run
outcomes go to `.fusion/ledger.jsonl` and `fusion stats`. Cascade
escalation and per-leg cost for Codex (the CLI reports tokens, not cost) are
still open.

Lineage: extend envelopes to `critique`, `repair`, and `select`
transformations; add offline replay verification and the ledger `lineage`
block.

- Add deterministic Cascade acceptance and escalation gates.
- Add a read-only critic and one bounded solver repair.
- Record role, provider, model, timing, cost inputs, evidence, and outcome per leg.
- Compare both workflows with the fixed-model baseline.

Exit criterion: held-out evaluation shows a useful tradeoff without weakening
security or adapter parity.

## Milestone 3: evaluation and viability decision

- Run preregistered quality, cost, latency, parity, fault, and bias studies.
- Compare against a fixed model and Quorum on equivalent tasks and budgets.
- Publish failures, exclusions, and uncertainty alongside aggregate results.
- Stop, narrow, or reposition if the stated stop criteria are met.

## Milestone 4: optional Parallel research

- Prototype isolated parallel candidates only after earlier milestones pass.
- Select one candidate through deterministic checks and an evidence judge.
- Do not automatically merge candidate text or patches.
- Re-run the full threat model and evaluation before considering release.

No learned router is planned until static policies have reproducible evidence,
sufficient data, and a separately reviewed learning and rollback design.
