# Research Notes

Last source review: 2026-09-16. External behavior, names, and documentation can
change; revalidate sources before implementation or publication.

## Verified primary-source facts

### GitHub Project HydraFusion

GitHub's September 4, 2026 article presents Project HydraFusion as a research
preview that selects among three current execution patterns: Single, Cascade,
and Critique. GitHub's September 1 community announcement says it shipped
experimentally in GitHub Copilot CLI, is enabled through `/experimental`, and is
available across Copilot plans. The FAQ says it is only in GitHub Copilot CLI;
no standalone package, external API, Claude Code integration, or Codex
integration is documented. Users cannot select the constituent models, and
intermediate passes are hidden.

In the described Critique pattern, an independent read-only critic from a
different model family reviews a draft and the drafting model revises once. The
article states principles including complete accounting, bounded execution,
isolated tool-less review, fail-safe application, and validated routing. These
are GitHub's stated design principles, not independently verified guarantees.
The article does not present Parallel candidates as a current HydraFusion
pattern.

GitHub reports results for best-tuned fixed HydraFusion policies on TerminalBench
2.1, DeepSWE, and its internal CheckpointBench. Relative to Claude Opus 5, the
article reports respectively: 67 percent lower estimated cost and +4.9 quality
points; 36 percent lower estimated cost and -1.5 points; and 65 percent lower
estimated cost and -0.1 points. These are GitHub-controlled offline best-tuned
results, not Fusion results or universal expectations. They depend on the
benchmark revisions, model pool, workflow, pricing, grading, execution limits,
missing-result treatment, and common medium reasoning level. CheckpointBench is
internal, policies were refined across all three evaluation sets, and two invalid
harness runs were excluded.

Sources:

- [GitHub Project HydraFusion article](https://github.blog/ai-and-ml/github-copilot/project-hydrafusion-frontier-quality-via-multi-model-orchestration/)
- [Official GitHub Community discussion](https://github.com/orgs/community/discussions/206492)

### HyDRA preprint

The HyDRA preprint describes adaptive multi-agent language model routing and is
useful research context for dynamic orchestration. It is not evidence that
Fusion's proposed policy or implementation works.

- [HyDRA preprint](https://arxiv.org/abs/2605.17106)

### Documented CLI surfaces

Claude Code documents programmatic use, including print mode, structured output
formats, tool controls, and turn limits. Its agent teams documentation describes
an experimental coordinated-team capability, while sub-agents are delegated
agents with separate context and configured tools. These are related concepts,
not a Fusion implementation contract by themselves.

- [Claude Code programmatic usage](https://code.claude.com/docs/en/headless)
- [Claude Code agent teams](https://code.claude.com/docs/en/agent-teams)
- [Claude Code sub-agents](https://code.claude.com/docs/en/sub-agents)

Codex documents its CLI and a noninteractive automation mode with structured
output and sandbox or approval controls. Codex is also published as open source.
Adapters must target current documented behavior and be fixture-tested because
schemas and capabilities can change.

- [Codex CLI](https://developers.openai.com/codex/cli)
- [Codex noninteractive mode](https://developers.openai.com/codex/noninteractive)
- [Codex open-source repository](https://github.com/openai/codex)

## Adjacent systems

- [Quorum](https://github.com/berrzebb/quorum) claims Claude, Gemini, and Codex
  adapters, deterministic gates, evidence storage, parallel worktrees, and
  several routing modes. Its released and default-branch capabilities must be
  distinguished and tested directly rather than dismissed by positioning.
- [MassGen](https://github.com/massgen/MassGen) claims parallel cross-model
  refinement and voting, Claude Code and Codex backends, isolated workspaces,
  budgets, a permission ledger, and automation mode. It is a direct competitor;
  its claims also require source and behavior audits.
- [Aider architect mode](https://aider.chat/docs/usage/modes.html) separates an
  architect's solution proposal from an editor model's implementation.
- [Cline](https://github.com/cline/cline),
  [OpenHands](https://github.com/OpenHands/OpenHands), and
  [SWE-agent](https://github.com/SWE-agent/SWE-agent) are broad coding-agent
  references with meaningful overlap in execution, tooling, or evaluation.

## Project hypotheses, not verified facts

- Static task and risk signals can select a better workflow than one fixed model.
- Per-leg provenance makes compound workflows sufficiently understandable.
- Deterministic gates plus one bounded repair improve reliability.
- Selecting one isolated candidate is safer than automatic textual merging.
- A later Parallel policy can justify its additional cost and attack surface.

## Research gaps

- Exact adapter parity across current Claude Code and Codex versions
- Fair, reproducible Quorum and MassGen comparisons under equal budgets
- Representative held-out repositories and task licensing
- Reliable provider usage and cost evidence without inferred values
- Judge bias, model-family leakage, and critic independence
- Worktree and cancellation behavior on adversarial repositories
