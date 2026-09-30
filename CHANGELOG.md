# Changelog

All notable changes to this project are documented here. The project follows
[Semantic Versioning](https://semver.org/); while the version is `0.x`, any
release may contain breaking changes.

## Unreleased

Fusion now executes. One command runs a write -> verify -> review -> repair
loop across Claude Code and Codex in an isolated git worktree and hands back a
patch; the user's working tree and branch are never modified by `run`.

### Added

- `fusion run "<task>"` with `--verify`, `--writer claude|codex`,
  `--reviewer codex|claude|none` (defaults to the other vendor), `--repairs 0..2`
  (default 1), `--model-writer`, `--model-reviewer`, `--timeout` (per step,
  default 900s), and `--yes`. `npm test` is auto-detected from
  `package.json`; with no verify gate the run warns loudly.
- Isolated worktree per run (`git worktree add --detach .fusion/runs/<id>/work
  HEAD`); `.fusion/` is added to `.git/info/exclude`, never `.gitignore`.
  Uncommitted changes trigger a warning and are not included.
- Process supervisor: agent CLIs are spawned with an argument array (no shell),
  each in its own process group; timeouts and Ctrl-C kill the whole group.
- Read-only reviewer (Codex `--sandbox read-only`, Claude `--permission-mode
  dontAsk` with only Read/Grep/Glob) that must return a JSON verdict. Fenced or
  embedded JSON is accepted; anything unparseable is "review unavailable",
  never an approval. Blocking findings always downgrade the verdict to
  `changes`.
- Bounded repair: a failed verify or blocking findings go back to the writer,
  followed by a full re-verify and re-review.
- Run artifacts: `patch.diff`, `report.md`, `report.json`, `events.json`
  (a `ProgressStream` with `origin: "runtime"` that passes `validate-events`),
  and one log per step under `logs/`.
- `fusion apply <id|latest>` (`git apply --3way`), `discard`, `list`,
  and `stats`. `.fusion/ledger.jsonl` records one line per run plus apply
  events; `stats` shows per-writer first-try verify pass rate, final pass rate,
  approval rate, average repairs, and blocking findings per run.
- `FUSION_CLAUDE_BIN` / `FUSION_CODEX_BIN` to point at other executables, and
  `FUSION_CLAUDE_EXTRA_ARGS` / `FUSION_CODEX_EXTRA_ARGS` for provider or
  profile flags (for example `-c model_provider="openai"`).
- Global `-C <dir>` option.
- `prepare` script so `npx github:inseat-labs/fusion` builds on install;
  the built bin is executable.
- Adapters: binding model `default` omits `--model` so each CLI uses its own
  configured default; Codex prompts are passed after `--`.
- Tests using fake agent executables and real temporary git repos (80 tests
  in total), plus Codex reconnect-error fixtures.

### Changed

- Renamed to fusion: package `@inseat-labs/fusion`, bin `fusion`, repository
  `inseat-labs/fusion` (previously `inseat-fusion`).
- New files under `.claude/` or `.codex/` created during a run (agent CLI hook
  and cache state) are left out of the patch and listed as a warning.
- The user's `node_modules` is symlinked into the worktree when present so the
  verify command can run; it is excluded from the patch.
- README rewritten around `run`; the "launches no provider process" status
  claims are gone. `plan`/`simulate` are documented as advanced dry-run tools.

### Fixed

- Codex adapter: `error` events that Codex emits while retrying a request
  ("Reconnecting... 1/5") no longer fail a step whose turn later completes;
  they become warnings. When retries are exhausted the last error message is
  reported instead of the first.
- Reviewer prompt tells the reviewer not to spawn sub-agents. In a real run
  Codex had delegated to a sub-agent and took 303s; with the change the same
  review took 46s.
- `apply` now points to `git diff HEAD`, because `git apply --3way` also
  stages the change and plain `git diff` shows nothing.

### Verified

- Real end-to-end run on 2026-09-30 with Claude Code 2.1.285 (writer) and
  codex-cli 0.153.4 (reviewer): READY in 1m 28s, `apply latest`, then the demo
  repo's `npm test` passed 3/3. Output is in the README.
- `npm pack`, install of the tarball in a fresh directory, and
  `npx fusion --help` work.

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
