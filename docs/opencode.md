# Using dn with OpenCode

This guide explains how to integrate `dn` with OpenCode's TUI for a seamless
conversational development workflow.

## Overview

OpenCode provides custom tools that let you run `dn` commands directly within
the TUI environment. The integration focuses on the conversational workflow that
works best in OpenCode's context, allowing you to plan and implement changes
without leaving the conversation.

Four tools are available:

- **`dn_prep`** - Create plan files from GitHub issues or local sources
- **`dn_loop`** - Execute iterative development using plan files
- **`dn_meld`** - Combine multiple sources into plan-ready documents
- **`dn_archive`** - Derive commit messages and complete workflows

## Prerequisites

### 1. Install dn

```bash
git clone <dn-repo-url>
cd dn
make install
```

### 2. GitHub Authentication

dn needs GitHub access for most operations. Set up one of:

**GitHub CLI (Recommended):**

```bash
gh auth login
```

**Browser Authentication:**

```bash
dn auth
```

**Environment Variable (for CI):**

```bash
export GITHUB_TOKEN=your_token_here
```

### 3. Install OpenCode

Download and install OpenCode from https://opencode.dev/

## Installation

The custom tools are automatically available when you:

1. Clone this repository to your local machine
2. Run OpenCode from the repository root

OpenCode detects tools in `.opencode/tools/` and makes them available as
`/dn_<command>`.

## Tool Reference

### dn_prep

Creates a plan file from a GitHub issue or local markdown source.

**Arguments:** `issue` (optional), `updateIssue` (optional), `dryRun`
(optional), `cursor` (optional), `planName` (optional), `workspaceRoot`
(optional)

```bash
/dn_prep issue="https://github.com/user/repo/issues/123"
/dn_prep issue="123" planName="feature-xyz" cursor=true
/dn_prep issue="https://github.com/user/repo/issues/123" updateIssue=true dryRun=true
```

### dn_loop

Executes the implementation phase using a previously created plan file.

**Arguments:** `planFile` (optional, required unless PLAN env var set), `cursor`
(optional), `workspaceRoot` (optional)

```bash
/dn_loop planFile="plans/feature-xyz.plan.md"
/dn_loop
/dn_loop planFile="plans/feature-xyz.plan.md" cursor=true
```

### dn_meld

Combines multiple markdown sources into a single plan-ready document.

**Arguments:** `sources` (optional), `output` (optional), `list` (optional),
`cursor` (optional)

```bash
/dn_meld sources=["https://github.com/user/repo/issues/101", "https://github.com/user/repo/issues/102"]
/dn_meld sources=["issue1.md", "issue2.md"] output="combined.md" cursor=true
/dn_meld list="sources.txt" output="plans/merged.plan.md"
/dn_meld sources=["docs/spec.md", "https://github.com/user/repo/issues/123"] output="combined.md"
```

### dn_archive

Derives a commit message from a plan file and optionally commits changes.

**Arguments:** `planFile` (required), `yolo` (optional)

```bash
/dn_archive planFile="plans/feature-xyz.plan.md"
/dn_archive planFile="plans/feature-xyz.plan.md" yolo=true
```

## Best Practices

### When to Use OpenCode vs CLI

**Use OpenCode integration for:**

- Conversational planning and iteration
- Quick plan creation from GitHub issues
- Melding sources while staying in context
- Commit message generation

**Use CLI for:**

- Full `dn kickstart` workflows (too slow for TUI)
- `dn glance` reports (designed for terminal output)
- Batch operations and automation
- CI/CD pipelines

### Workflow Tips

1. **Start with `dn_prep`**: Create a plan from your issue or source first
2. **Review the plan**: Use OpenCode's file tools to review and edit the
   generated plan
3. **Iterate with `dn_loop`**: Run multiple loop cycles as needed for complex
   features
4. **Clean up with `dn_archive`**: Derive meaningful commit messages and
   maintain repository hygiene

### Environment Variables

- `PLAN` - Default plan file for dn_loop (e.g. `plans/my-feature.plan.md`)
- `CURSOR_ENABLED` - Set to `1` to enable Cursor integration by default
- `OPENCODE_TIMEOUT_MS` - Timeout for OpenCode agent invocations (default:
  600000, i.e. 10 minutes)

## Troubleshooting

**"dn command not found"**

- Ensure dn is installed and in your PATH
- Run `make install` in the dn repository

**Authentication errors**

- Set up GitHub authentication: `gh auth login` or `dn auth`
- For CI, set `GITHUB_TOKEN` environment variable

**Plan file not found**

- Ensure `dn_prep` completed successfully
- Check the plan file path in the `plans/` directory
- Use explicit `planFile` argument or set `PLAN` environment variable

**Permission denied errors**

- Ensure OpenCode has read/write access to your repository
- Check file permissions for the `plans/` directory

**Getting help:** Run `dn <command> --help`, verify with `gh auth status` and
`dn --version`, and review OpenCode logs for detailed errors.

## Advanced Usage

### Custom Workspaces

For monorepo projects or custom directory structures:

```bash
/dn_prep issue="https://github.com/user/repo/issues/123" workspaceRoot="packages/my-package"
/dn_loop planFile="packages/my-package/plans/issue-123.plan.md" workspaceRoot="packages/my-package"
```

### Issue Template Management

```bash
/dn_prep issue="https://github.com/user/repo/issues/123" updateIssue=true
/dn_prep issue="123" updateIssue=true dryRun=true
```

### Batch Operations

For batch processing, use the CLI outside OpenCode:

```bash
for issue in 101 102 103; do
  dn prep $issue
  dn loop --plan-file plans/issue-$issue.plan.md
  dn archive plans/issue-$issue.plan.md --yolo
done
```

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for contribution guidelines.
