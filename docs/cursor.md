# Using Cursor with Kickstart

This guide explains Cursor execution targets in dn, including the local Cursor
CLI, durable Cursor Cloud Agents, and Cursor IDE as an outer harness.

## Cursor IDE as outer harness

When you chat in Cursor with `dn` on `PATH`, Cursor is the **outer** harness.
Install the repo skill so the agent implements with the CLI, then asks before
committing:

```bash
dn init agents --skill --agent cursor
dn init agents --skill --agent cursor --scope user   # ~/.cursor/skills/dn/
```

That writes `.cursor/skills/dn/SKILL.md` (never `~/.cursor/skills-cursor/`).
Hybrid behavior:

- User names an issue, a plan, or a dn verb → orchestrate the CLI
- A pasted GitHub issue URL plus kickstart → pass the full URL; add
  `--allow-cross-repo` when `owner/repo` is not this workspace; put extra
  guidance in `--steer`; leave other flags at CLI defaults
- After kickstart or loop, summarize and **ask** whether to commit
- If yes, this chat writes the commit (omit `*.plan.md`)
- Ad-hoc edits in chat → implement in-session; same ask-before-commit step
- Do not pass `--agent cursor` unless asked (avoids Cursor-in-Cursor)
- Plan mode maps to `dn meld`; after the plan is accepted, `dn loop`, then ask

`dn land` is for attended CLI, CI, denoise, `--issue-testplan`, RFC land, or
when you name `dn land`. `dn sync` publishes to trunk after a local commit.

## Execution Targets

| Target             | Command                                            | Where work runs                          | Result                                                     |
| ------------------ | -------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------- |
| Cursor CLI         | `dn kickstart --agent cursor <issue>`              | Current machine or GitHub Actions runner | dn's normal local plan and implementation workflow         |
| Cursor Cloud Agent | `dn kickstart --cursor-cloud --publish pr <issue>` | Cursor-managed VM                        | A durable remote run; Cursor creates the PR when requested |
| Sandbox            | `--sandbox docker\|exe.dev`                        | Docker or exe.dev around a local harness | Isolation layer, not a Cursor agent runtime                |
| GitHub Actions     | `dn.kickstart_issue` workflow                      | GitHub-hosted runner                     | Runs the configured local harness in CI                    |

`--cursor-cloud` requires `CURSOR_API_KEY` and is intentionally separate from
`--agent cursor` and `--sandbox`. By default it queues the run and exits after
Cursor returns its durable run and agent IDs; the cloud VM owns its repository
clone, so it does not update local plan files or the current workspace. Use
`--publish pr` when the completed remote work should open a pull request.

When denoise (or another orchestrator) sets `DN_DISPATCH_ID` plus
`DN_PROGRESS=ndjson|http`, `dn` **waits** for the Cursor cloud run to finish and
emits kickstart progress events (including `data.pr_url` when Cursor returns a
pull request). Without those variables, CLI behavior stays fire-and-forget.

For loop-only work, pass a plan file:

```bash
dn loop --cursor-cloud plans/my-feature.plan.md
```

Optional `--ref <git-ref>` sets the cloud repository starting ref (default:
`main`):

```bash
dn kickstart --cursor-cloud --ref develop --publish pr <issue>
```

## Cursor CLI in GitHub Actions

## Prerequisites

- A GitHub repository with kickstart configured
- A Cursor API key (for background agent mode)

## Required Setup

### 1. GitHub and Cursor Setup

- Enable "Allow GitHub Actions to create and approve pull requests" in Settings
  → Actions → General → Workflow permissions
- Add a `CURSOR_API_KEY` repository secret (from Cursor IDE settings)

See
[GitHub workflow permissions and secrets](https://docs.github.com/en/actions/security-guides).

### 2. Workflow Configuration

The workflow file needs these permissions to create branches and PRs:

```yaml
permissions:
  contents: write # Push branches
  pull-requests: write # Create PRs
  issues: write # Comment on issues
```

Example workflow (`.github/workflows/kickstart-cursor.yml`):

```yaml
name: Kickstart (Cursor)

on:
  workflow_dispatch:
    inputs:
      issue_url:
        description: "GitHub issue URL to process"
        required: true
        type: string
  issues:
    types: [labeled]

permissions:
  contents: write
  pull-requests: write
  issues: write

jobs:
  kickstart:
    name: Run kickstart with Cursor
    runs-on: ubuntu-latest
    if: >
      github.event_name == 'workflow_dispatch' ||
      (github.event_name == 'issues' &&
       github.event.action == 'labeled' &&
       github.event.label.name == 'cursor awp')
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Install Deno
        uses: denoland/setup-deno@v1
        with:
          deno-version: v2.x

      - name: Install Cursor CLI
        run: |
          curl https://cursor.com/install -fsS | bash
          echo "$HOME/.cursor/bin" >> $GITHUB_PATH

      - name: Configure git identity
        run: |
          git config user.name "GitHub Actions"
          git config user.email "actions@github.com"

      - name: Run kickstart
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          CURSOR_API_KEY: ${{ secrets.CURSOR_API_KEY }}
        run: |
          make kickstart_deno_cursor ISSUE="${{ github.event.inputs.issue_url }}"
```

## How It Works

1. **Trigger**: Workflow runs on `workflow_dispatch` (manual) or when an issue
   is labeled with `cursor awp`
2. **Setup**: Installs Deno and Cursor CLI on the runner
3. **Execution**: Runs kickstart with `--awp --agent cursor` flags, which:
   - Creates an implementation plan
   - Uses Cursor's agent to implement the changes
   - Creates a branch and opens a PR
4. **Authentication**: Uses `GITHUB_TOKEN` for git/PR operations and
   `CURSOR_API_KEY` for the Cursor agent

## Troubleshooting

### "GitHub Actions is not permitted to create or approve pull requests"

The repository setting is not enabled. Go to **Settings** → **Actions** →
**General** → **Workflow permissions** and enable PR creation.

### "Error: CURSOR_API_KEY not set"

Add the `CURSOR_API_KEY` secret to your repository. See the setup section above.

### Cursor CLI not found

Ensure the install step adds the CLI to `$GITHUB_PATH`:

```yaml
- name: Install Cursor CLI
  run: |
    curl https://cursor.com/install -fsS | bash
    echo "$HOME/.cursor/bin" >> $GITHUB_PATH
```

### Git push fails

Ensure the workflow has `contents: write` permission and uses `fetch-depth: 0`
in the checkout step.

### "non-fast-forward" push rejected

This happens when retrying a failed run where the branch already exists from a
previous attempt. Kickstart uses `--force-with-lease` to safely overwrite the
existing branch. If you still see this error, the remote branch may have been
modified by someone else since the last fetch.

## Branch Naming

Kickstart creates branches with the `kickstart/` prefix:

```
kickstart/issue_123_add-new-feature
```

This prefix identifies auto-generated branches where force push is expected
behavior (for retries). The full format is:
`kickstart/issue_{number}_{title-slug}`

## Security Considerations

- The `CURSOR_API_KEY` secret grants access to Cursor's agent capabilities.
  Treat it like any other sensitive credential.
- The `GITHUB_TOKEN` is automatically provided by GitHub Actions with the
  permissions specified in the workflow.
- Consider using a fine-grained PAT if you need more control over repository
  access.

## Related Documentation

- [GitHub Authentication](authentication.md) - Token and auth setup
