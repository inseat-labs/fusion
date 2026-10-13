# Contributing

Fusion is early (0.x). `fusion run` executes Claude Code and Codex for real; `plan` and `simulate` stay dry-run. First pull requests are welcome; issues labelled [good first issue](https://github.com/inseat-labs/fusion/labels/good%20first%20issue) are a good start. Tests use fake agent CLIs, so you do not need Claude or Codex installed to contribute.

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Development

```bash
npm ci
npm test            # vitest
npm run typecheck   # tsc --noEmit
npm run build       # emits dist/
npm run dev -- plan examples/tasks/*.json
```

Milestone 0 code must not spawn processes, read repositories, or write outside
the test runner. Every schema change needs a test, and every adapter parsing
change needs a fixture in `fixtures/adapters/`. Cost or usage that the CLI did
not report must stay `unavailable`.

Contributions that improve product boundaries, architecture, threat analysis,
source accuracy, or the evaluation design are equally welcome.

## Before proposing a change

- Read the README, architecture, ADRs, threat model, and evaluation plan.
- Separate verified facts from project hypotheses.
- Cite primary sources for claims about external projects.
- State overlap with existing tools directly; do not imply affiliation.
- Keep all examples non-executable and free of credentials or customer data.

## Review expectations

A proposal should explain the user problem, affected invariant, security impact,
evaluation impact, and any new provider dependency. Documentation changes should
use concise ASCII text and working relative links.

Do not add runtime execution, setup recipes for live providers, benchmarks
presented as ours, provider branding, or ownership assertions until the
corresponding milestone in [ROADMAP.md](ROADMAP.md) is started.

By contributing, you agree that your contribution is licensed under the Apache
License 2.0 in [LICENSE](LICENSE).
