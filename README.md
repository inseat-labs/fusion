# Inseat Fusion

Inseat Fusion is an early-stage, independent open-source controller for coding
workflows that run through documented noninteractive CLI interfaces.

> Status: early development (Milestone 0 starter). A dry-run CLI exists that
> validates a task, selects a workflow with a static policy, and renders the exact
> legs, commands, gates, and budgets it would use. It launches no provider
> process and modifies no repository. There is no execution engine yet.

The product hypothesis is that a transparent policy can choose among Single,
Cascade, Critique with one bounded repair, and later Parallel candidate
workflows based on task risk and explicit budgets. Each workflow leg would show
its model, role, cost, latency, outcome, and evidence. Deterministic gates would
select a candidate before one final patch is applied atomically.

## Important overlap and uncertainty

This idea overlaps materially with GitHub Project HydraFusion, Quorum, MassGen,
and general coding-agent orchestrators. Its proposed differentiation is narrower:
adaptive workflow policy, transparent per-leg provenance/cost/latency,
deterministic acceptance gates, and atomic final patch application. That
differentiation is a hypothesis, not a validated advantage. The project must
stop or change direction if evaluation does not show a useful gain over a fixed
model or Quorum.

Inseat Fusion is inspired by public ideas described for GitHub Project
HydraFusion. GitHub currently documents HydraFusion only as an experimental
Copilot CLI feature; constituent model selection and intermediate passes are not
exposed to users. Inseat Fusion is not affiliated with or endorsed by GitHub, is
not a clone or reverse engineering effort, and does not use GitHub internals. It
is also distinct from Inseat Switch, a model-migration compatibility checker
rather than a workflow controller.

## Planned workflows

- **Single:** one solver produces a candidate.
- **Cascade:** an initial solver runs first; a deterministic gate either accepts
  the candidate or escalates to a stronger configured solver.
- **Critique and one repair:** a read-only critic reviews a candidate, then the
  solver receives one bounded repair opportunity.
- **Parallel, later:** isolated solvers produce candidates from the same
  immutable base, then a verifier and evidence judge select one. Parallel is our
  proposed later strategy. GitHub does not report it as a current HydraFusion
  pattern.

The controller would never automatically combine candidate patches through
unsafe textual merging. It would select one candidate, optionally permit one
bounded repair, verify it, and apply one final patch.

## Quick start (dry-run only)

Requires Node.js 22 or newer. Claude Code and Codex CLIs are not required for
Milestone 0 because nothing is executed.

```bash
git clone https://github.com/inseat-labs/inseat-fusion.git
cd inseat-fusion
npm ci
npm test
npm run plan:examples
```

`plan:examples` renders dry-run plans for the synthetic tasks in
`examples/tasks/`. Add `-- --json` for the `DryRunPlan` document or
`-- --ledger` for the dry-run ledger. See [examples/README.md](examples/README.md).

Two more commands exercise the progress-event contract without running anything:

```bash
npm run dev -- simulate examples/tasks/high-risk-critique.json --scenario timed-out --at 1
npm run validate:progress
```

## Three kinds of behavior, kept distinct

| Kind | What it means | Where |
| --- | --- | --- |
| Implemented Milestone 0 behavior | Deterministic code with tests: schemas, policy selection, invocation planning, output parsing, dry-run plans, ledger, progress-stream validation | `src/` |
| Dry-run simulation | Synthetic `ProgressStream`s with `origin: "dry-run-simulation"`, fixed timestamps from 2000-01-01, produced by `simulate`. They exercise the state machine. They are not telemetry and say nothing about how a real run would behave | `fixtures/progress/valid/` |
| Planned live execution | Process supervisor, worktree isolation, verifier, judge, repair, atomic apply. A future runtime must emit `origin: "runtime"` events that pass the same validator | Milestone 1+, no code |

## What exists today

| Area | State |
| --- | --- |
| Versioned Zod schemas: task, policy, adapter capabilities, invocation plan, result envelope, dry-run plan, ledger | implemented |
| Static policy engine with a default rule set and recorded decision inputs | implemented |
| Claude Code and Codex adapters: capability declaration, invocation planning, output parsing to a normalized envelope | implemented against shapes revalidated 2026-09-19 ([docs/CLI_CONTRACTS.md](docs/CLI_CONTRACTS.md)), fixture-tested |
| Dry-run planner for Single, Cascade, and Critique with deterministic gates | implemented |
| Ledger serialization with key-name secret redaction and `unavailable` usage semantics | implemented |
| Versioned `ProgressEvent` / `ProgressStream` schema, transition table, stream validator (contiguous sequence, monotonic timestamps, legal transitions, no events after terminal) | implemented |
| Deterministic dry-run simulator for nominal, cancelled, timed-out, and budget-exhausted scenarios | implemented, clearly labeled simulation |
| Process supervisor, worktree isolation, verifier, atomic applicator, live execution | not implemented (Milestone 1+) |

## Advisory decision providers

No probabilistic decision provider is integrated. See
[docs/ADR-003-JEV-ADVISORY-ONLY.md](docs/ADR-003-JEV-ADVISORY-ONLY.md): any
future provider is optional, disabled by default, receives only allowlisted
redacted state, abstains on low confidence, and can never override a
deterministic failure. Boundary-lineage integrity is designed in
[docs/BOUNDARY_LINEAGE.md](docs/BOUNDARY_LINEAGE.md) and scheduled for
Milestones 1 and 2.

## MVP boundary

The first implementation milestone is deliberately small:

- static workflow policies and dry-run planning
- Claude Code and Codex adapter contracts with fixtures
- explicit budgets, timeouts, cancellation, and progress events (done)
- planned verification and provenance event schemas
- malformed-output, cancellation, and schema-drift fixtures (done)
- no process execution or repository mutation
- no learned router and no Parallel execution in the initial MVP

Isolated solver worktrees and atomic patch application belong to Milestone 1.
Read-only critics and bounded repair belong to Milestone 2.

Users would bring their own API keys or CLI credentials. Inseat Fusion would not
resell credentials, proxy access, or conceal provider usage.

## Documents

- [ARCHITECTURE.md](ARCHITECTURE.md): components, invariants, and flow
- [ROADMAP.md](ROADMAP.md): milestones and acceptance criteria
- [docs/PRODUCT_PLAN.md](docs/PRODUCT_PLAN.md): audience, value hypothesis, and boundaries
- [docs/RESEARCH.md](docs/RESEARCH.md): verified sources, claims, and open questions
- [docs/COMPETITORS.md](docs/COMPETITORS.md): overlap and differentiation risks
- [docs/EVALUATION_PLAN.md](docs/EVALUATION_PLAN.md): preregistered comparison plan
- [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md): assets, threats, and mitigations
- [docs/HANDOFF.md](docs/HANDOFF.md): exact next implementation order
- [examples/README.md](examples/README.md): synthetic, non-executable scenarios
- [CHANGELOG.md](CHANGELOG.md): release notes

## License

The repository is licensed under Apache License 2.0. See [LICENSE](LICENSE).
