# GitHub Actions

Use `dn` in automated workflows to trigger kickstart from issue labels, slash
commands, or manual dispatches.

## Quick setup

The recommended way to install `dn` in GitHub Actions is with the
[chesapeake/dn-action](https://github.com/chesapeake/dn-action) composite
action:

```yaml
jobs:
  kickstart:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install dn
        uses: chesapeake/dn-action@v1

      - name: Run kickstart
        run: dn --awp --opencode "${{ github.event.issue.html_url }}"
```

## Using `dn init-build`

`dn init-build` scaffolds the full workflow for you:

```bash
# Interactive mode (prompts for agent selection)
dn init-build

# Or specify agent directly
dn init-build --agent cursor
dn init-build --agent claude
dn init-build --agent opencode
```

It creates `.github/workflows/denoise-build.yaml` (with your selected agent) and
a `denoise-build` label. Maintainers trigger builds by adding the label to any
issue. The generated workflow includes the agent-specific flag and required
secret configuration.

After running `dn init-build`, add the required API key as a repository secret:

```bash
gh secret set OPENAI_API_KEY --body "your-key"      # for opencode
gh secret set CURSOR_API_KEY --body "your-key"      # for cursor
gh secret set ANTHROPIC_API_KEY --body "your-key"    # for claude
```

See
[`.github/templates/denoise-build.yaml`](.github/templates/denoise-build.yaml)
for the full template.

## Manual workflow setup

If you write a workflow from scratch, use `chesapeake/dn-action` after
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
        uses: chesapeake/dn-action@v1

      - name: Run dn kickstart
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          IS_OPEN_SOURCE: "true"
          NO_COLOR: "1"
        run: |
          OUTPUT=$(dn --awp --cursor "${{ github.event.issue.html_url }}" 2>&1) || EXIT_CODE=$?

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
- uses: chesapeake/dn-action@v1
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
[`dn-actions/.github/workflows/`](https://github.com/chesapeake/dn-actions):

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

`chesapeake/dn-action` supports:

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
    deno compile --allow-all -o dn https://esm.sh/chesapeake/dn/cli/main.ts
    echo "$PWD" >> $GITHUB_PATH
```
