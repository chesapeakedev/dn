# Using Cursor with Kickstart

This guide explains how to configure GitHub Actions to run kickstart with
Cursor's `agent` CLI and allow it to create pull requests.

## Prerequisites

- A GitHub repository with kickstart configured
- A Cursor API key (for background agent mode)

## Required Setup

### 1. Enable PR Creation for GitHub Actions

By default, GitHub Actions workflows cannot create pull requests. You must
enable this in your repository settings.

1. Go to your repository on GitHub
2. Navigate to **Settings** → **Actions** → **General**
3. Scroll to **Workflow permissions**
4. Enable **Allow GitHub Actions to create and approve pull requests**
5. Click **Save**

Without this setting, you'll see the error:

```
GitHub Actions is not permitted to create or approve pull requests
```

### 2. Add the Cursor API Key Secret

The Cursor agent CLI requires an API key for background operation.

1. Go to your repository on GitHub
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Name: `CURSOR_API_KEY`
5. Value: Your Cursor API key
6. Click **Add secret**

To obtain a Cursor API key:

1. Open Cursor IDE
2. Go to **Settings** → **API Keys** (or your account settings)
3. Generate a new API key for CI usage

### 3. Workflow Configuration

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
3. **Execution**: Runs kickstart with `--awp --cursor` flags, which:
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

Add the `CURSOR_API_KEY` secret to your repository. See step 2 above.

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

- [GitHub Authentication](authentication.md) - Token setup for local usage
- [GitHub Token Setup](github-token-setup.md) - Detailed PAT instructions
