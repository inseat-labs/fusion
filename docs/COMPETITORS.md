# Competitors and Overlap

Competitor overlap is substantial, and Fusion's viability is unvalidated.
The project should not proceed on positioning alone.

## Project HydraFusion

GitHub publicly describes adaptive selection among Single, Cascade, and Critique
workflows with accounting, bounded execution, isolated review, and fail-safe
application. GitHub's community announcement says the experimental feature is
currently only in Copilot CLI, with constituent model selection unavailable and
intermediate passes hidden. This is direct conceptual overlap. Fusion is
an independent proposal limited to documented external CLI interfaces,
transparent local ledgers, deterministic gates, and an atomic patch boundary.
It is not affiliated with or endorsed by GitHub, does not use GitHub internals,
and is not a clone or reverse engineering effort.

## Quorum

Quorum is the most important direct OSS comparison because it coordinates
multiple coding agents and model perspectives. The proposed distinction is not
"multiple agents"; it is policy-driven selection of the least complex workflow,
per-leg provenance/cost/latency, deterministic acceptance gates, and selection
of one atomic patch. These claims require a feature audit and controlled
evaluation against current Quorum behavior.

## MassGen

MassGen is also a direct OSS comparison. Its project claims parallel
cross-model refinement and voting, Claude Code and Codex backends, isolated
workspaces, budgets, automation, and a permission ledger. Fusion cannot
differentiate merely by supporting multiple CLIs, isolation, or visible costs.
The narrower hypothesis is that a small fixed-policy engine with fail-closed
gates and one selected atomic patch is easier to audit and evaluate. That must
be tested against a frozen MassGen revision under equal budgets.

## Aider architect mode

Aider's architect mode already separates solution design from editing. Inseat
Fusion's proposed Critique workflow and role separation overlap with that idea.
The intended scope adds cross-CLI policy selection, verification, isolation, and
ledgering, but complexity alone is not differentiation.

## Cline, OpenHands, and SWE-agent

These projects cover broad coding-agent execution, tools, repository changes,
and evaluation. Fusion is intentionally narrower: a local workflow
controller over existing documented CLIs, not another general autonomous coding
environment. Integration burden and duplicated safety mechanisms remain risks.

## Claude agent teams and sub-agents

Claude Code offers native team and delegated-agent concepts. They may make some
external coordination redundant for Claude-only users. Fusion must show
that cross-CLI policy transparency and deterministic patch control justify an
additional layer.

## Decision rule

Continue only if held-out evaluation demonstrates a useful and reproducible
quality/cost/latency or safety advantage over a fixed-model baseline and fair
Quorum and MassGen configurations. Otherwise stop, narrow to an evaluation
harness, or contribute missing capabilities upstream where appropriate.
