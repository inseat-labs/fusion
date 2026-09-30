# External CLI contract revalidation

Reviewed: 2026-09-19. No paid model task was run. Evidence is limited to
official documentation, open-source protocol definitions, and local `--help`
output. Anything not listed under "Verified" is unverified.

## Claude Code

| Item | Value |
| --- | --- |
| Local CLI version | `2.1.278 (Claude Code)` via `claude --version` |
| Primary source | https://code.claude.com/docs/en/headless |
| Result type source | https://code.claude.com/docs/en/agent-sdk/typescript (`SDKResultMessage`) |
| Adapter | `src/adapters/claude-code/index.ts` |

### Verified

- Non-interactive mode is `-p` / `--print`. `--output-format` accepts `text`,
  `json`, `stream-json`; `json` emits a single result object.
- `--model`, `--allowedTools`, `--tools`, `--permission-mode` (values
  `acceptEdits`, `auto`, `bypassPermissions`, `manual`, `dontAsk`, `plan`),
  `--max-budget-usd`, `--json-schema`, `--bare`, `--permission-prompts` exist in
  local `--help`.
- Result object fields: `type: "result"`, `subtype` is `"success"` or one of
  `error_max_turns`, `error_during_execution`, `error_max_budget_usd`,
  `error_max_structured_output_retries`. `is_error` is a boolean on both arms.
  Success carries `result: string`. Error arms carry `errors: string[]`. Both
  carry `session_id`, `total_cost_usd`, `usage` (`input_tokens`,
  `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`),
  `modelUsage` keyed by model name, `permission_denials`, and optional
  `terminal_reason` (includes `"budget_exhausted"`, `"max_turns"`,
  `"completed"`).
- `total_cost_usd` is documented as a client-side estimate, not a bill.
- SIGTERM exits with code 143 and records no result for the in-progress turn.

### Adapter changes made

- Accept every documented `subtype`; treat unknown subtypes as `schema-drift`.
- Map `error_max_budget_usd` or `terminal_reason: budget_exhausted` to the new
  `budget-exhausted` outcome. Other error subtypes or `is_error: true` map to
  `failed`.
- Read `errors[]` into the summary when `result` is absent.
- Record `session_id` as `providerRef`, `terminal_reason` as `terminalReason`.
- Derive `model` from the single `modelUsage` key; leave null and warn otherwise.
- Mark `costUsd` with `costIsEstimate: true`.
- Warn when `permission_denials` is non-empty.
- Critic invocation now uses `--permission-mode dontAsk --tools Read,Grep,Glob
  --allowedTools Read,Grep,Glob` so anything outside the allowlist is denied
  rather than prompted.
- Pass `--max-budget-usd` when the task budget sets `maxUsd`.

### Uncertainties

- `--max-turns` is not present in local `--help` and is not used.
- `--bare` is recommended for scripted use but does not use subscription login
  and requires `ANTHROPIC_API_KEY`. Not added; conflicts with the
  "user-cli-login" credential assumption. Revisit in Milestone 1.
- `-p` sessions run project hooks and `.mcp.json` servers without a trust
  prompt. Isolated worktrees must be inspected for these before Milestone 1.
- `modelUsage` value shape is not parsed; only its keys are used.
- Exit codes other than 0, non-zero on failure, and 143 on SIGTERM are not
  documented.

## Codex CLI

| Item | Value |
| --- | --- |
| Local CLI version | `codex-cli 0.153.4` via `codex --version` |
| Latest release seen | `rust-v0.155.1` (2026-09-18) |
| Primary source | https://learn.chatgpt.com/docs/non-interactive-mode (redirect target of developers.openai.com/codex/noninteractive) |
| Event schema source | https://github.com/openai/codex/blob/78245b47af2a/codex-rs/exec/src/exec_events.rs |
| Adapter | `src/adapters/codex/index.ts` |

### Verified

- Non-interactive command is `codex exec`. `--json` prints JSONL events to
  stdout. `-m/--model`, `-s/--sandbox` (`read-only`, `workspace-write`,
  `danger-full-access`), `-C/--cd`, `--ephemeral`, `-o/--output-last-message`,
  `--output-schema`, `--skip-git-repo-check` exist in local `--help`.
- Event `type` values: `thread.started` (`thread_id`), `turn.started`,
  `turn.completed` (`usage`), `turn.failed` (`error.message`), `item.started`,
  `item.updated`, `item.completed` (`item`), `error` (`message`).
- `usage` fields: `input_tokens`, `cached_input_tokens`,
  `cache_write_input_tokens`, `output_tokens`, `reasoning_output_tokens`. No
  cost field is emitted.
- `item` is `{ id, type, ...details }` with snake_case `type`:
  `agent_message` (`text`), `reasoning`, `command_execution` (`command`,
  `aggregated_output`, `exit_code`, `status`), `file_change` (`changes[{path,
  kind}]`, `status`), `mcp_tool_call`, `collab_tool_call`, `web_search`,
  `todo_list`, `error` (`message`).

### Adapter changes made

- Handle `turn.failed` and top-level `error` events as `failed`, using the
  message as the summary.
- Collect `changedFiles` from `file_change` items.
- Record `thread_id` as `providerRef`.
- Parse `cached_input_tokens` and `reasoning_output_tokens`. Never synthesize a
  cost.
- Warn when `turn.completed` is present but the exit code is non-zero.
- 2026-09-30, from a real run: Codex emits top-level `error` events while it
  retries (`"Reconnecting... 1/5 (...)"`). They are fatal only when no
  `turn.completed` follows; otherwise they become warnings. The last error is
  used as the summary. Fixtures: `reconnect-then-success.jsonl`,
  `reconnect-exhausted.jsonl`.
- The prompt is passed after `--` and `--model` is omitted unless the user
  sets one, so the CLI's configured default model is used. `exec` prints
  "Reading additional input from stdin..." to stderr; Fusion's stdin is
  `/dev/null`, so it proceeds immediately.

### Uncertainties

- Exit codes are not documented. Source shows `std::process::exit(1)` on several
  failure paths. Treated as non-zero on failure, unverified.
- Local `0.153.4` is two releases behind `0.155.1`. Fixture shapes follow the
  `main` source at the pinned revision.
- The docs page was fetched through a redirect; the canonical URL may change.

## Fixture and documentation updates

Fixtures under `fixtures/adapters/` were regenerated to include the documented
fields. `documentationCheckedOn` in both capability records is `2026-09-19`.
