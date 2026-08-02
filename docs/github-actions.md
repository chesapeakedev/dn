# GitHub Actions

Use `dn` in automated workflows to validate and run kickstart from GitHub
Actions.

## Quick setup

The recommended way to install `dn` in GitHub Actions is with the
[chesapeakedev/dn-action](https://github.com/chesapeakedev/dn-action) composite
action:

```yaml
jobs:
  kickstart:
    runs-on: ubuntu-latest
    steps:
      - name: Run kickstart
        uses: chesapeakedev/dn-action@v1
        with:
          workflow: dn.kickstart_issue
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

## Canonical Workflow Templates

Install the canonical workflow templates and pick one agent for the repository:

```bash
dn init workflows --agent claude
gh secret set ANTHROPIC_API_KEY
# Commit .github/dn/config.json and the workflows
dn workflows validate --json
```

The templates define stable `repository_dispatch` event contracts for
`dn.init_stack`, `dn.meld_issue_plan`, and `dn.kickstart_issue`, plus the
scheduled/manual `dn.daily_kickstart` workflow. Each job uses one action step
that reads `.github/dn/config.json`, validates the event, installs the
configured agent harness, runs `dn --agent <configured>`, and writes a workflow
summary. You do not pass `agent` on each dispatch.

For daily kickstart automation, initialize a milestone stack PR, merge it, then
set the repository variable used by scheduled runs:

```bash
dn init build --agent claude
dn init stack 42 --publish pr
gh variable set DN_DAILY_KICKSTART_MILESTONE --body 42
# Commit .github/dn/ and .github/workflows/, then merge the stack PR
```

`.github/workflows/dn-daily-kickstart.yml` runs once per day and also supports
manual `workflow_dispatch` with a `milestone` input. Each run executes one queue
item:

```bash
dn --agent <configured> kickstart --publish pr --milestone <milestone> --once
```

When the milestone variable is unset, the stack file is missing on the default
branch, or the queue has no unchecked items, the workflow soft-passes with a
summary message instead of failing. Install/update also removes the retired
`.github/workflows/dn-todo-loop.yml` file when present.

See [Denoise integration](denoise-integration.md) for payload schemas,
permissions, secrets, and versioning details.

| Agent      | Set once with                 | Repository secret   |
| ---------- | ----------------------------- | ------------------- |
| `opencode` | `dn init workflows` (default) | `OPENAI_API_KEY`    |
| `claude`   | `--agent claude`              | `ANTHROPIC_API_KEY` |
| `cursor`   | `--agent cursor`              | `CURSOR_API_KEY`    |
| `codex`    | `--agent codex`               | `OPENAI_API_KEY`    |

## Manual workflow setup

If you write a workflow from scratch, use `chesapeakedev/dn-action` after
`actions/checkout`:

```yaml
name: Kickstart with dn

on:
  issues:
    types: [labeled]

permissions:
  contents: write
  pull-requests: write
  issues: write

jobs:
  kickstart:
    if: github.event.label.name == 'cursor awp'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Install dn
        uses: chesapeakedev/dn-action@v1

      - name: Run dn kickstart
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          IS_OPEN_SOURCE: "true"
          NO_COLOR: "1"
        run: |
          OUTPUT=$(dn --agent cursor kickstart --awp "${{ github.event.issue.html_url }}" 2>&1) || EXIT_CODE=$?

          PR_URL=$(echo "$OUTPUT" | grep -oP 'PR created: \K[^\s]+' || true)

          if [ -n "$PR_URL" ]; then
            echo "success=true" >> $GITHUB_OUTPUT
          else
            echo "success=false" >> $GITHUB_OUTPUT
          fi

          exit ${EXIT_CODE:-0}
```

## Version pinning

Pin to a specific release to avoid unexpected updates:

```yaml
- uses: chesapeakedev/dn-action@v1
  with:
    version: "1.2.3"
```

## Required permissions

| Permission             | Reason                                  |
| ---------------------- | --------------------------------------- |
| `contents: write`      | Clone repo, push branches, commit plans |
| `pull-requests: write` | Open pull requests                      |
| `issues: write`        | Post results and status comments        |

Also add the relevant API key as a repository secret (e.g., `OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`).

## Reusable workflows

This repository provides reusable workflows in
[`dn-actions/.github/workflows/`](https://github.com/chesapeakedev/dn-actions):

| Workflow                | Purpose                                                        |
| ----------------------- | -------------------------------------------------------------- |
| `kickstart-comment.yml` | Posts a formatted comment on the triggering issue with results |

Example:

```yaml
comment:
  needs: kickstart
  uses: dn-actions/.github/workflows/kickstart-comment.yml@v1
  with:
    issue_number: ${{ needs.kickstart.outputs.issue_number }}
    issue_url: ${{ needs.kickstart.outputs.issue_url }}
    kickstart_title: opencode
    trigger_source: issue_label
    label_name: opencode awp
    labeler: ${{ github.event.sender.login }}
    success: ${{ needs.kickstart.outputs.success }}
    pr_url: ${{ needs.kickstart.outputs.pr_url }}
    output: ${{ needs.kickstart.outputs.output }}
  secrets: inherit
```

## Platforms

`chesapeakedev/dn-action` supports:

| OS      | Arch  | Binary               |
| ------- | ----- | -------------------- |
| Linux   | x64   | `dn-linux-x64`       |
| Linux   | ARM64 | `dn-linux-arm64`     |
| macOS   | x64   | `dn-macos-x64`       |
| macOS   | ARM64 | `dn-macos-arm64`     |
| Windows | x64   | `dn-windows-x64.exe` |

For other platforms, install from source:

```yaml
- uses: denoland/setup-deno@v1
  with:
    deno-version: ">=2.6.3"

- name: Install dn from source
  run: |
    deno compile --allow-all -o dn https://esm.sh/chesapeakedev/dn/cli/main.ts
    echo "$PWD" >> $GITHUB_PATH
```
