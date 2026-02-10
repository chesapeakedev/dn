# Using dn with OpenCode

This guide explains how to integrate `dn` with OpenCode's TUI for a seamless
conversational development workflow.

## Overview

OpenCode provides custom tools that let you run `dn` commands directly within
the TUI environment. This integration focuses on the conversational workflow
that works best in OpenCode's context, allowing you to plan and implement
changes without leaving the conversation.

The integration provides four tools:

- **`dn_prep`** - Create plan files from GitHub issues or local sources
- **`dn_loop`** - Execute iterative development using plan files
- **`dn_meld`** - Combine multiple sources into plan-ready documents
- **`dn_archive`** - Derive commit messages and complete workflows

## Prerequisites

### 1. Install dn

```bash
# Clone and build dn from source
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

OpenCode automatically detects tools in `.opencode/tools/` and makes them
available as `/dn_<command>`.

## Workflow Examples

### Basic GitHub Issue Workflow

```bash
# 1. Create a plan from a GitHub issue
/dn_prep issue="https://github.com/user/repo/issues/123"

# 2. Execute the plan iteratively  
/dn_loop planFile="plans/issue-123.plan.md"

# 3. Create commit message and clean up
/dn_archive planFile="plans/issue-123.plan.md" yolo=true
```

### Multi-source Planning

```bash
# Combine multiple issues and files into a single plan
/dn_meld sources=["https://github.com/user/repo/issues/101", "https://github.com/user/repo/issues/102", "docs/background.md"] output="combined.md"

# Create a plan from the combined source
/dn_prep issue="combined.md"
```

### Cursor Integration

```bash
# Create Cursor-compatible plan
/dn_prep issue="https://github.com/user/repo/issues/123" cursor=true

# Execute with Cursor integration
/dn_loop planFile="plans/issue-123.plan.md" cursor=true
```

## Tool Reference

### dn_prep

Creates a plan file from a GitHub issue or local markdown source.

**Arguments:**

- `issue` (optional): GitHub issue URL or issue number
- `updateIssue` (optional): Fill empty issue template sections
- `dryRun` (optional): Preview changes without updating the issue
- `cursor` (optional): Add Cursor-compatible YAML frontmatter
- `planName` (optional): Custom plan name (without .plan.md extension)
- `savePlan` (optional): Save plan to file (default: true)
- `workspaceRoot` (optional): Custom workspace root directory

**Examples:**

```bash
# Create plan from GitHub issue
/dn_prep issue="https://github.com/user/repo/issues/123"

# Create plan with custom name and Cursor support
/dn_prep issue="123" planName="feature-xyz" cursor=true

# Preview issue updates without applying
/dn_prep issue="https://github.com/user/repo/issues/123" updateIssue=true dryRun=true
```

### dn_loop

Executes the implementation phase using a previously created plan file.

**Arguments:**

- `planFile` (optional): Path to plan file (required, can use PLAN env var)
- `cursor` (optional): Enable Cursor integration mode
- `workspaceRoot` (optional): Custom workspace root directory

**Examples:**

```bash
# Execute plan file
/dn_loop planFile="plans/feature-xyz.plan.md"

# Use environment variable instead of explicit path
# Set PLAN=plans/feature-xyz.plan.md in your shell
/dn_loop

# Execute with Cursor integration
/dn_loop planFile="plans/feature-xyz.plan.md" cursor=true
```

### dn_meld

Combines multiple markdown sources into a single plan-ready document.

**Arguments:**

- `sources` (optional): Array of source files and/or GitHub issue URLs
- `output` (optional): Output file path (default: stdout)
- `list` (optional): File containing newline-separated list of sources
- `cursor` (optional): Add Cursor-compatible YAML frontmatter

**Examples:**

```bash
# Merge multiple issues to stdout
/dn_meld sources=["https://github.com/user/repo/issues/101", "https://github.com/user/repo/issues/102"]

# Merge to file with Cursor frontmatter
/dn_meld sources=["issue1.md", "issue2.md"] output="combined.md" cursor=true

# Use source list file
/dn_meld list="sources.txt" output="plans/merged.plan.md"

# Mix local files and GitHub URLs
/dn_meld sources=["docs/spec.md", "https://github.com/user/repo/issues/123"] output="combined.md"
```

### dn_archive

Derives a commit message from a plan file and optionally commits changes.

**Arguments:**

- `planFile` (required): Path to plan file
- `yolo` (optional): Auto-commit staged files and delete the plan file

**Examples:**

```bash
# Generate commit message only
/dn_archive planFile="plans/feature-xyz.plan.md"

# Generate message and auto-commit
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

1. **Start with `dn_prep`**: Always begin by creating a plan from your issue or
   source
2. **Review the plan**: Use OpenCode's file tools to review and edit the
   generated plan
3. **Iterate with `dn_loop`**: Run multiple loop cycles as needed for complex
   features
4. **Clean up with `dn_archive`**: Derive meaningful commit messages and
   maintain repository hygiene

### Environment Variables

These variables work with the tools:

```bash
# Default plan file for dn_loop
export PLAN="plans/my-feature.plan.md"

# Enable Cursor integration by default
export CURSOR_ENABLED="1"
```

### File Organization

By convention, dn stores plan files in a `plans/` directory at the repository
root. The tools follow this convention:

- `dn_prep` creates files in `plans/`
- `dn_loop` expects files in `plans/`
- `dn_archive` cleans up files from `plans/`

## Troubleshooting

### Common Issues

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

### Getting Help

1. Check dn documentation: `dn <command> --help`
2. Verify GitHub authentication: `gh auth status`
3. Test dn installation: `dn --version`
4. Review OpenCode logs for detailed error information

## Advanced Usage

### Custom Workspaces

For monorepo projects or custom directory structures:

```bash
# Create plan in custom workspace
/dn_prep issue="https://github.com/user/repo/issues/123" workspaceRoot="packages/my-package"

# Execute in same workspace
/dn_loop planFile="packages/my-package/plans/issue-123.plan.md" workspaceRoot="packages/my-package"
```

### Issue Template Management

Use `dn_prep` to standardize issue descriptions:

```bash
# Fill missing template sections in GitHub issues
/dn_prep issue="https://github.com/user/repo/issues/123" updateIssue=true

# Preview changes before applying
/dn_prep issue="123" updateIssue=true dryRun=true
```

### Batch Operations

While OpenCode is great for conversational workflows, you can still use the CLI
for batch operations:

```bash
# Process multiple issues (CLI example)
for issue in 101 102 103; do
  dn prep $issue
  dn loop --plan-file plans/issue-$issue.plan.md
  dn archive plans/issue-$issue.plan.md --yolo
done
```

## Contributing

To contribute to the dn + OpenCode integration:

1. Fork the dn repository
2. Modify `.opencode/tools/dn.ts` for tool changes
3. Update this documentation (`docs/opencode.md`)
4. Test with your OpenCode workflow
5. Submit a pull request

For dn-specific issues, see the main dn documentation and contribution
guidelines.
