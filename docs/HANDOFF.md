# Implementation Handoff

## Current state

Milestone 0 is complete as of 2026-09-19. From a clean checkout, `npm ci`,
`npm test` (61 tests), `npm run build`, `npm run plan:examples`, and
`npm run validate:progress` pass on Node 24.

Implemented:

- Zod schemas (`src/schemas`): task, policy and decision, adapter capabilities,
  invocation plan, result envelope (now with `providerRef`, `terminalReason`,
  and a `budget-exhausted` outcome), dry-run plan (with `progressModel`
  specification), ledger, progress event and stream. All carry `version: 1`.
- Static policy engine with `DEFAULT_POLICY`; every decision records rule id and
  inputs.
- Adapters for Claude Code and Codex revalidated against official docs and
  local CLIs on 2026-09-19 (`docs/CLI_CONTRACTS.md`). Critic legs use
  `--permission-mode dontAsk` with a Read/Grep/Glob tool allowlist, or
  `--sandbox read-only`. `--max-budget-usd` is passed when `maxUsd` is set.
- Dry-run planner and renderers.
- Ledger with key-name redaction and `unavailable` usage semantics.
- Progress: `TRANSITIONS` table, `validateProgressStream`, `simulateProgress`
  for nominal / cancelled / timed-out / budget-exhausted at any leg; 4 valid and
  9 invalid fixtures; CLI `simulate` and `validate-events`.

Not implemented in 0.1.0: anything that runs.

### Unreleased: the `run` runtime (2026-09-30)

`fusion run` now executes one writer -> verify -> read-only review ->
bounded repair loop in `git worktree add --detach .fusion/runs/<id>/work HEAD`
(`src/runtime/`), plus `apply`, `discard`, `list`, `stats`. `npm test` runs 80
tests, including fake-agent runs in real temp git repos. One real end-to-end
run (Claude Code 2.1.285 writer, codex-cli 0.153.4 reviewer) is captured in
the README. Still not implemented: judge, Cascade, Parallel, atomic apply with
base-drift check, boundary-lineage envelopes.

## Decisions taken

- Sequence numbers must be contiguous from 0. Gaps are rejected. A runtime that
  drops events must therefore fail validation rather than pass silently.
- `planned -> running` is illegal; `ready` is mandatory so gate evaluation is an
  observable step.
- Simulated streams are always `origin: "dry-run-simulation"` and use fixed
  timestamps from 2000-01-01. The dry-run plan and ledger never embed simulated
  events; the plan embeds only the state table as `progressModel`.
- Claude Code `--bare` is not used because it bypasses subscription login.
- Codex exit codes are treated as non-zero-on-failure but are undocumented.

## Next agent instructions

1. Read `docs/BOUNDARY_LINEAGE.md` (design only) and `docs/ADR-003-JEV-ADVISORY-ONLY.md`
   before Milestone 1 so the runtime emits what those documents require.
2. Milestone 1 leftovers: boundary-lineage envelopes, a base-drift check before
   `apply`, and fault-injection tests for cancellation cleanup. The process
   supervisor, worktree isolation, and `origin: "runtime"` events exist.
3. Inspect isolated worktrees for `.claude/settings.json` hooks and `.mcp.json`
   before launching `claude -p`, since `-p` runs them without a trust prompt.
4. Do not add Parallel, learned routing, textual merge, or any Jev SDK.
5. Run the full suite and build before handing off and report exact commands
   and outcomes.
