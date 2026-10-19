# Contributing

Fusion is early (0.2, on npm as `agent-fusion`). `fusion run` executes Claude Code and Codex for real; `plan` and `simulate` stay dry-run. First pull requests are welcome; issues labelled [good first issue](https://github.com/inseat-labs/fusion/labels/good%20first%20issue) are a good start. Tests use fake agent CLIs, so you do not need Claude or Codex installed to contribute.

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Development

Requires Node.js 22+ and git.

```bash
npm ci
npm test            # vitest, including fake-agent runs in temporary git repos
npm run typecheck   # tsc --noEmit
npm run build       # emits dist/
```

Run the CLI from source with `npm run dev --` (`-C` goes before the command):

```bash
npm run dev -- -C /path/to/test-repo run "<task>" --verify "npm test"
npm run dev -- -C /path/to/test-repo list
npm run dev -- plan examples/tasks/*.json     # dry-run planner, runs nothing
```

A real `run` uses your own Claude Code and Codex logins and quota. Point it at
a throwaway repository you trust. To exercise the loop without the real CLIs,
set `FUSION_CLAUDE_BIN` / `FUSION_CODEX_BIN` to stand-in executables, as
`tests/run.test.ts` does with the fakes from `tests/helpers/fake-agents.ts`.

## Rules for changes

- Agent CLIs are spawned with an argument array, never through a shell. Only
  the user's own verify command runs through a shell.
- `run` must not modify the user's branch or working tree; only `apply` does.
- Every schema change needs a test, and every adapter parsing change needs a
  fixture in `fixtures/adapters/`.
- Cost or usage that the CLI did not report must stay `unavailable`.
- `plan`, `simulate`, and `validate-events` stay dry-run: they spawn no
  processes and modify no repository.
- Add a CHANGELOG entry under "Unreleased" for user-visible changes.

Contributions that improve product boundaries, architecture, threat analysis,
source accuracy, or the evaluation design are equally welcome.

## Before proposing a change

- Read the README, architecture, ADRs, threat model, and evaluation plan.
- Separate verified facts from project hypotheses.
- Cite primary sources for claims about external projects.
- State overlap with existing tools directly; do not imply affiliation.
- Keep examples free of credentials or customer data.

## Review expectations

A proposal should explain the user problem, affected invariant, security impact,
evaluation impact, and any new provider dependency. Documentation changes should
use concise ASCII text and working relative links.

Do not add benchmarks presented as ours, provider branding, or ownership
assertions.

By contributing, you agree that your contribution is licensed under the Apache
License 2.0 in [LICENSE](LICENSE).
