# Product Plan

## Problem

Developers can manually ask one coding model to solve, another to review, or a
stronger model to retry. That process is difficult to reproduce and obscures
which leg changed quality, cost, and latency. Existing orchestrators already
cover much of this territory, so product viability is unvalidated.

## Intended users

- maintainers who use both Claude Code and Codex through documented CLIs
- teams that require explicit budgets, deterministic checks, and patch atomicity
- researchers comparing workflow policies rather than only individual models

## Value hypothesis

A small local controller can choose the least complex configured workflow likely
to meet a quality gate while making every decision and provider leg inspectable.
The proposed advantage over a fixed model, Quorum, and broader orchestrators is
adaptive workflow selection plus transparent provenance and atomic application.
Evaluation may reject this hypothesis.

## MVP

The dry-run MVP (Milestone 0, complete 2026-09-19) contains static policies,
dry-run planning, adapter
contract fixtures for Claude Code and Codex, verification evidence schemas and
fixtures, explicit budget and timeout schemas, cancellation semantics, progress
events, and a provenance ledger format. It does not execute provider processes,
run repository checks, mutate repositories, contain a learned router, launch
Parallel candidates, merge patches, host credentials, or act as a general agent
platform.

Since then, the unreleased `run` command executes the Single and Critique
workflows for real: one writer CLI in an isolated worktree, the user's verify
command, a read-only reviewer from the other vendor, and up to two repairs.
It still does not merge patches, host credentials, or run Parallel candidates.

## User experience principles

- Show the selected policy and reason before execution.
- Show each leg's role, state, elapsed time, budget, and verified usage evidence.
- Label unavailable cost or token data as unavailable rather than estimating it
  silently.
- Explain gates, escalation, repair, candidate selection, and final application.
- Preserve the base on cancellation or failure.

## Boundaries

Fusion uses only documented provider interfaces. Users bring their own
credentials. The project does not proxy or resell provider access, use GitHub
internals, reproduce HydraFusion, or replace repository-specific CI and review.
It is distinct from Switch's migration-compatibility purpose.

## Viability questions

1. Do static policies improve quality/cost/latency tradeoffs on held-out tasks?
2. Does transparency remain accurate across provider output differences?
3. Can deterministic gates reduce judge dependence without rejecting good work?
4. Is the improvement meaningful against Quorum, MassGen, and a fixed-model baseline?
5. Does process and worktree isolation hold under adversarial repositories?
