# Using Claude Code with Kickstart

This guide explains how to run `dn` with Anthropic’s Claude Code CLI (`claude`)
in print mode (`claude -p`), including GitHub Actions patterns.

## Prerequisites

- [Claude Code installed](https://docs.anthropic.com/en/docs/claude-code/quickstart)
- **Default (local):** the same
  [Claude Code](https://docs.anthropic.com/en/docs/claude-code/quickstart)
  login/session you use in the terminal (no `ANTHROPIC_API_KEY` required if you
  are already authenticated).
- **Bare / CI:** set `CLAUDE_CODE_BARE=1` and provide an
  [Anthropic API key](https://console.anthropic.com/) in `ANTHROPIC_API_KEY`
  (see [headless mode](https://docs.anthropic.com/en/docs/claude-code/headless))

## Local usage

```bash
dn --agent claude kickstart https://github.com/owner/repo/issues/123
dn --agent claude prep https://github.com/owner/repo/issues/123
dn --agent claude loop --plan-file plans/issue-123.plan.md
dn --agent claude fixup https://github.com/owner/repo/pull/123
dn meld a.md b.md --claude
```

Legacy command-level `--claude` flags still work. Or set `CLAUDE_ENABLED=1`
instead of passing `--agent claude`. Do not set another agent env toggle at the
same time.

`dn` invokes `claude -p` **without** `--bare` by default, like Cursor’s headless
`agent` flow: your normal CLI auth and project `CLAUDE.md` apply. Set
`CLAUDE_CODE_BARE=1` for isolated, API-key-oriented runs (typical in CI).
Override tool pre-approval with `CLAUDE_ALLOWED_TOOLS` if needed (default
`Bash,Read,Edit`).

`dn` passes `--permission-mode acceptEdits` to `claude` by default so plan and
implement phases can write `plans/*.plan.md` (and other edits) without blocking
on interactive approval—similar to Cursor’s `agent --force` and OpenCode’s
allowed edit paths. Override with `CLAUDE_PERMISSION_MODE` (`default`,
`bypassPermissions`, `acceptEdits`, `plan`, `auto`, `dontAsk`). For fully
isolated sandboxes only, `CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS=1` adds
`--dangerously-skip-permissions` (see `claude --help`).

## GitHub Actions

Enable **Allow GitHub Actions to create and approve pull requests** (Settings →
Actions → General → Workflow permissions). Add repository secret
`ANTHROPIC_API_KEY`.

Example job steps:

```yaml
- name: Install Claude Code
  run: |
    curl -fsSL https://claude.ai/install.sh | bash
    echo "$HOME/.local/bin" >> $GITHUB_PATH

- name: Run dn kickstart (Claude AWP)
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    CLAUDE_CODE_BARE: "1"
    NO_COLOR: "1"
  run: |
    dn --agent claude kickstart --awp "${{ github.event.issue.html_url }}"
```

This repository includes
[`.github/workflows/kickstart-claude-foss.yml`](../.github/workflows/kickstart-claude-foss.yml),
triggered when a maintainer adds the **`claude awp`** label to an issue (same
pattern as the Cursor and OpenCode FOSS workflows).

For Anthropic’s managed GitHub app and action, see
[Claude Code GitHub Actions](https://docs.anthropic.com/en/docs/claude-code/github-actions).

## Troubleshooting

### `claude command not found`

Install Claude Code and ensure `claude` is on `PATH`. On CI, add the install
script’s bin directory to `$GITHUB_PATH` (often `$HOME/.local/bin`).

### “Not logged in · Please run /login”

You are in the default (non-bare) path but Claude Code has no saved session in
this environment. Run `claude` once interactively and complete login, or set
`CLAUDE_CODE_BARE=1` with `ANTHROPIC_API_KEY` for headless use (see
[headless documentation](https://docs.anthropic.com/en/docs/claude-code/headless)).

### Authentication errors with `CLAUDE_CODE_BARE=1`

Bare mode does not use interactive login; use `ANTHROPIC_API_KEY` or provider
credentials as described in the
[headless documentation](https://docs.anthropic.com/en/docs/claude-code/headless).

### Plan phase completes but `plans/*.plan.md` is missing

Claude Code was waiting for edit approval while `dn` runs `claude` with stdin
closed. With current `dn` versions, `--permission-mode acceptEdits` is applied
by default; if you still see permission blocks, try
`CLAUDE_PERMISSION_MODE=bypassPermissions` or confirm your Claude Code version
supports `--permission-mode` (`claude --help`).

### Timeouts

Increase `CLAUDE_TIMEOUT_MS` (falls back to `OPENCODE_TIMEOUT_MS`, default 10
minutes).

## Related documentation

- [Authentication](authentication.md) — GitHub token setup
- [Output and environment](output-and-environment.md) — CI and env vars
- [Subcommands](subcommands.md) — CLI reference
