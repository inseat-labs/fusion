# Fusion

One command: Claude writes, your tests check, Codex reviews, one repair — you
get a verified patch; your branch stays untouched.

> Status: early (0.x, unreleased runtime). `run` executes real Claude Code and
> Codex CLIs with your own logins. Expect rough edges; see
> [Limitations](#limitations).

## 30-second quickstart

Requires Node.js 22+, git, and the `claude` and `codex` CLIs installed and
logged in. From inside any git repo with at least one commit:

```bash
npx github:inseat-labs/fusion run "Fix the failing slugify tests" --verify "npm test"
# read the summary, then:
npx github:inseat-labs/fusion apply latest   # git apply --3way into your working tree
```

When installed, the same commands are `fusion run` and `fusion apply`.

Omit `--verify` and Fusion uses `npm test` when `package.json` has a test
script; with no verify command at all it warns loudly that nothing will be
tested. Nothing is committed; `apply` only changes your working tree when you
run it.

## Real demo

A throwaway repo (`/tmp/fusion-demo`) with a committed `src/slugify.js` whose
`node --test` suite fails (it only replaced the first space and kept accents).
Claude Code 2.1.285 as writer (its default model), Codex CLI 0.153.4 as
reviewer. Captured verbatim on 2026-09-30:

```text
$ fusion run "Fix slugify so all tests pass, including accented characters" --verify "npm test" --yes
fusion [0:00] leg-0 running   writer claude: write
fusion [0:15] … writer claude still running (15s)
fusion [0:30] … writer claude still running (30s)
fusion [0:41] leg-0 succeeded writer claude succeeded in 41s
fusion [0:41] leg-1 running   verify: npm test
fusion [0:42] leg-1 succeeded verify PASS (exit 0)
fusion [0:42] leg-2 running   reviewer codex: review (read-only)
fusion [0:57] … reviewer codex still running (15s)
fusion [1:12] … reviewer codex still running (30s)
fusion [1:27] … reviewer codex still running (45s)
fusion [1:28] leg-2 succeeded reviewer codex succeeded in 46s
fusion [1:28] review: APPROVE (0 blocking, 0 suggestion(s))
fusion WARNING: left 2 new agent-CLI state file(s) out of the patch: .claude/tsc-cache/837c75ad-7fe5-4156-b3b3-039444877e9c/affected-repos.txt, .claude/tsc-cache/837c75ad-7fe5-4156-b3b3-039444877e9c/edited-files.log

== fusion run 20260930-154701-eb35 ==
Task      Fix slugify so all tests pass, including accented characters
Status    READY: verify passed, codex approved. Your branch is untouched.
Writer    claude  write succeeded 41s
Verify    PASS  npm test
Reviewer  codex  APPROVE  0 blocking, 0 suggestion(s)
Repairs   0 of 1 used
Changed   1 file(s), +6 -1
          src/slugify.js | 7 ++++++-
          1 file changed, 6 insertions(+), 1 deletion(-)
Duration  1m 28s  (CLI-reported cost estimate: $0.2302; other legs report no cost)
Artifacts .fusion/runs/20260930-154701-eb35/  (patch.diff, report.md, report.json, events.json, logs/)
Warnings
  ! left 2 new agent-CLI state file(s) out of the patch: .claude/tsc-cache/837c75ad-7fe5-4156-b3b3-039444877e9c/affected-repos.txt, .claude/tsc-cache/837c75ad-7fe5-4156-b3b3-039444877e9c/edited-files.log

Next
  git -C .fusion/runs/20260930-154701-eb35/work diff HEAD      inspect the change
  fusion apply 20260930-154701-eb35   apply the patch to your working tree (git apply --3way)
  fusion discard 20260930-154701-eb35 remove the worktree and run files
  fusion stats                      which writer delivers in this repo

$ git status --short

$ fusion list
ID                    STATUS  WRITER>REVIEWER  VERIFY  REVIEW   FILES  APPLIED  TASK
20260930-154701-eb35  ready   claude>codex     PASS    approve  1      no       Fix slugify so all tests pass, including accented characters

$ fusion stats
WRITER  RUNS  VERIFY 1ST TRY  VERIFY FINAL  APPROVED    AVG REPAIRS  BLOCKING/RUN  APPLIED  AVG TIME
claude  1     100% (1/1)      100% (1/1)    100% (1/1)  0.00         0.00          0        1m 28s

Which agent delivers in this repo, from your own runs (.fusion/ledger.jsonl). Small samples are noisy.

$ fusion apply latest
applied run 20260930-154701-eb35 to your working tree (1 file(s): src/slugify.js). Review with `git diff HEAD` (--3way also stages it); nothing was committed.
$ npm test
ℹ tests 3
ℹ suites 0
ℹ pass 3
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 182.968205
$ git status --short
M  src/slugify.js
```

`npm test` output is the tail. The `apply` shown was re-run with the final
build after restoring the file (the first apply printed the older hint
"Review with `git diff`"; the patch and result were identical). The empty `git status --short` after the run is the point: the user's tree was
not touched until `apply`. The `.claude/tsc-cache` warning comes from a
Claude Code hook in the demo machine's user config; Fusion keeps such new
agent-CLI state files out of the patch. On that machine Codex's configured
default provider was a gateway without access, so the run used
`FUSION_CODEX_EXTRA_ARGS='-c model_provider="openai" -c model_reasoning_effort="medium"'`.

## How it compares

| Project | What it is | Who checks the work |
| --- | --- | --- |
| [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc) | Codex review commands you invoke manually inside a Claude Code session | You decide when to ask for a review and what to do with it |
| [claude-squad](https://github.com/smtg-ai/claude-squad), [vibe-kanban](https://github.com/BloopAI/vibe-kanban) | Managers for many parallel agent sessions in separate worktrees | A human reviews each session's result |
| agent-orchestrator | Orchestration for teams of agents working on larger tasks | Depends on the configured workflow |
| **Fusion** | One task, one writer, one cross-vendor reviewer, a fixed loop | Your test command gates it, the other vendor reviews it, you apply it |

What Fusion adds:

- **An automated, test-gated, cross-vendor loop:** write -> verify -> read-only
  review -> bounded repair -> re-verify/re-review, in an isolated
  `git worktree` so your branch is never touched until you `apply`.
- **A per-repo ledger:** `.fusion/ledger.jsonl` records every run, and
  `fusion stats` shows which writer passes your tests first try, gets
  approved, and needs repairs — in your repo, not on a public benchmark.

It does not run agents in parallel, manage long-lived sessions, or replace a
human merge decision.

## Commands

```text
fusion run "<task>" [--verify "<cmd>"] [--writer claude|codex] [--reviewer codex|claude|none]
                  [--repairs 0|1|2] [--model-writer <m>] [--model-reviewer <m>] [--timeout <sec>] [--yes]
fusion apply <id|latest>     git apply --3way the run's patch into your working tree
fusion discard <id|latest>   remove the run's worktree and files (ledger entry is kept)
fusion list                  runs in this repo with their status
fusion stats                 per-writer first-try verify pass rate, approval rate, repairs
```

- Writer defaults to `claude`; reviewer defaults to the other vendor.
  `--repairs` defaults to 1; `--timeout` is per step (default 900s) and kills
  the whole process group.
- Writer: `claude -p … --permission-mode acceptEdits` or
  `codex exec --sandbox workspace-write`, with the worktree as cwd. Reviewer:
  `codex exec --sandbox read-only` or `claude -p … --permission-mode dontAsk`
  with only Read/Grep/Glob, and must answer with JSON
  `{"verdict","blocking":[],"suggestions":[]}`.
- A run is `ready` only if verify passed and the reviewer approved.
  Unparseable review output is "review unavailable", never an approval.
- Artifacts per run: `.fusion/runs/<id>/{patch.diff,report.md,report.json,events.json,logs/}`.
  `.fusion/` is added to `.git/info/exclude`.
- Environment: `FUSION_CLAUDE_BIN` / `FUSION_CODEX_BIN` point at other
  executables; `FUSION_CLAUDE_EXTRA_ARGS` / `FUSION_CODEX_EXTRA_ARGS` append
  whitespace-separated flags (no shell).
- Without `--yes` on a TTY, Fusion prints the plan and asks before spending
  CLI quota. Exit code 0 means READY, 1 means not ready, 2 means usage/setup
  error.

## Limitations

- Sequential and single-writer: one writer, one reviewer, up to two repairs.
  No parallel candidates or Cascade escalation yet.
- Works from `HEAD`: uncommitted changes are not included (Fusion warns).
- Cost is only shown when a CLI reports it (Claude Code does; Codex reports
  tokens only). No budget enforcement across the run.
- The reviewer verdict is a JSON heuristic: bare, fenced, or embedded JSON is
  accepted; anything else is "unavailable". A reviewer can still be wrong.
- Your verify command runs with your permissions in the worktree; it is not
  sandboxed. `node_modules` is symlinked from your repo when present.
- `apply` uses `git apply --3way`; if your tree drifted from the run's base,
  resolve conflicts yourself. There is no base-drift check yet.

## Advanced: dry-run planning and simulation

The original Milestone 0 planner is still here. `plan`, `simulate`, and
`validate-events` launch no provider CLI and modify no repository.

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

Fusion is inspired by public ideas described for GitHub Project
HydraFusion. GitHub currently documents HydraFusion only as an experimental
Copilot CLI feature; constituent model selection and intermediate passes are not
exposed to users. Fusion is not affiliated with or endorsed by GitHub, is
not a clone or reverse engineering effort, and does not use GitHub internals. It
is also distinct from Switch, a model-migration compatibility checker
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
bounded repair, verify it, and apply one final patch. Today `run` implements
Single plus Critique with up to two repairs; Cascade and Parallel are planned.

### Dry-run commands

These need Node.js 22+ but not the Claude Code or Codex CLIs.

```bash
git clone https://github.com/inseat-labs/fusion.git
cd fusion
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
| Live execution (`run`) | Real Claude Code / Codex processes in an isolated worktree, your verify command, read-only review, bounded repair. Emits `origin: "runtime"` events that pass the same validator | `src/runtime/` |

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
| Process supervisor (no-shell spawn, process-group timeout kill), worktree isolation, verify gate, read-only reviewer, bounded repair, `apply`/`discard`/`list`/`stats`, per-repo ledger | implemented (`run`), tested with fake agent executables in real temp git repos and one real end-to-end run |
| Evidence judge, Cascade escalation, Parallel candidates, atomic applicator with base-drift check | not implemented |

## Advisory decision providers

No probabilistic decision provider is integrated. See
[docs/ADR-003-JEV-ADVISORY-ONLY.md](docs/ADR-003-JEV-ADVISORY-ONLY.md): any
future provider is optional, disabled by default, receives only allowlisted
redacted state, abstains on low confidence, and can never override a
deterministic failure. Boundary-lineage integrity is designed in
[docs/BOUNDARY_LINEAGE.md](docs/BOUNDARY_LINEAGE.md) and scheduled for
Milestones 1 and 2.

## Scope

Milestone 0 (contracts and dry-run planning) shipped in 0.1.0. The `run`
runtime covers most of Milestone 1 (isolated Single workflow) and the Critique
half of Milestone 2 (read-only critic, bounded repair); see
[ROADMAP.md](ROADMAP.md) for what is still open. There is no learned router and
no Parallel execution.

Users bring their own CLI logins. Fusion does not resell credentials,
proxy access, or conceal provider usage.

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
