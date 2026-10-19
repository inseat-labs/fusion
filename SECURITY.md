# Security Policy

## Current status

Fusion is early-stage software (0.2), published on npm as
[`agent-fusion`](https://www.npmjs.com/package/agent-fusion). It executes code
on your machine:

- `fusion run` launches the Claude Code and Codex CLIs with your own logins,
  in an isolated git worktree checked out from `HEAD` under
  `.fusion/runs/<id>/work`. Agent CLIs are spawned without a shell, each in its
  own process group, with a per-step timeout. The writer edits files in the
  worktree (`claude --permission-mode acceptEdits` or
  `codex exec --sandbox workspace-write`); the reviewer is limited to read-only
  tools (`claude --permission-mode dontAsk` with Read/Grep/Glob, or
  `codex exec --sandbox read-only`).
- Your verify command (for example `npm test`) runs through a shell in the
  worktree with your permissions and environment. It is not sandboxed.
- Your branch and working tree are not modified by `run`. Only
  `fusion apply` changes them, with `git apply --3way`.
- The agent CLIs and the verify command inherit your environment variables.
  Run logs are written in full under `.fusion/runs/<id>/logs/` and are not
  redacted.

Known gap: only run Fusion on repositories you trust. The Claude steps run
`claude -p` with your Claude Code settings plus the repository's own committed
`.claude/` settings (including hooks) and `.mcp.json`. Fusion does not pass
`--setting-sources` or `--strict-mcp-config`, so a hostile repository's hooks
run as you, and its MCP servers may too. In addition, `node_modules` is linked
into the worktree as a symlink to your repository's copy, so writes there land
in your `node_modules`.

[docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) lists which controls exist today
and which are still planned. The dry-run commands (`plan`, `simulate`,
`validate-events`) launch no provider process and modify no repository.

## Reporting

Report suspected vulnerabilities privately to abenezer@inseat.app. Include the
affected version, component, or document, impact, reproduction details when safe,
and suggested mitigation. Do not include live secrets, private repository
contents, or customer data.

There is no response or remediation SLA. Reports will be reviewed as capacity
allows. Public disclosure should be coordinated when practical, but no timing
commitment is promised.

The project will never ask reporters to disclose API keys or CLI credentials.
See [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) for the trust boundaries.
