# Security Policy

## Current status

Fusion is early-stage software. Milestone 0 (complete 2026-09-19) is a
dry-run CLI that validates task files, selects a workflow with a static policy,
renders planned legs, commands, gates, and budgets, and validates or simulates
progress-event streams. It launches no provider process, reads or modifies no
repository, makes no network requests, and needs no credentials. There is no
published npm package and no execution engine.

A later milestone would execute coding CLIs against untrusted repositories, so
security reports about the current CLI and the proposed design are both welcome
before that work begins.

## Reporting

Report suspected vulnerabilities privately to abenezer@inseat.app. Include the
affected version, component, or document, impact, reproduction details when safe,
and suggested mitigation. Do not include live secrets, private repository
contents, or customer data.

There is no response or remediation SLA. Reports will be reviewed as capacity
allows. Public disclosure should be coordinated when practical, but no timing
commitment is promised.

The project will never ask reporters to disclose API keys or CLI credentials.
See [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) for the planned trust boundaries.
