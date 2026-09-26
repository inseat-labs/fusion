# Changelog

All notable changes to this project are documented here. The project follows
[Semantic Versioning](https://semver.org/); while the version is `0.x`, any
release may contain breaking changes.

## 0.1.0 - 2026-09-26

First tagged release of the Milestone 0 dry-run planner (complete 2026-09-19).
Early-stage: schemas may still change, and the package is not published to npm.
Nothing in this release executes a provider CLI or touches a repository.

### Added

- `inseat-fusion plan <task.json>...` renders a dry-run plan (legs, commands,
  gates, budgets) as text, `--json` (`DryRunPlan`), or `--ledger`. Accepts a
  custom static policy via `--policy`.
- `inseat-fusion simulate` emits a deterministic `ProgressStream` labeled
  `origin: "dry-run-simulation"` for nominal, cancelled, timed-out, and
  budget-exhausted scenarios.
- `inseat-fusion validate-events` checks progress streams for contiguous
  sequence numbers, monotonic timestamps, legal transitions, and no events
  after a terminal state.
- Versioned Zod schemas (`version: 1`) for task, policy and decision, adapter
  capabilities, invocation plan, result envelope, dry-run plan, ledger, and
  progress events.
- Static policy engine with a default rule set selecting Single, Cascade, or
  Critique, recording the rule id and inputs for every decision.
- Claude Code and Codex adapters: capability declarations, invocation planning,
  and output parsing, fixture-tested against CLI shapes revalidated 2026-09-19
  (`docs/CLI_CONTRACTS.md`).
- Ledger serialization with key-name secret redaction; unreported cost or
  usage stays `unavailable`.
- Three synthetic example tasks, adapter and progress fixtures, and 61 tests.
- GitHub Actions CI on Node.js 22 and 24.

### Limits

- No process supervisor, worktree isolation, verifier, judge, repair, atomic
  patch application, or live execution. These are Milestone 1+ in `ROADMAP.md`.
- Parallel workflows, learned routing, and patch merging are out of scope.
