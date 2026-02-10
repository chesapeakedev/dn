# Subcommands

This document describes all `dn` CLI subcommands in detail. For installation and
authentication, see the project README.

## `dn kickstart` — Full workflow

Runs complete kickstart workflow (plan + implement phases):

```bash
# Default mode: Apply changes locally
dn kickstart https://github.com/owner/repo/issues/123
dn kickstart 123

# From a local markdown file (no GitHub fetch; AWP not used)
dn kickstart docs/spec.md

# AWP mode: Full workflow with branches and PR
dn kickstart --awp https://github.com/owner/repo/issues/123

# Cross-repository workflow (implement issue from different repo)
dn kickstart --allow-cross-repo https://github.com/private-org/backend-api/issues/123

# With Cursor integration
dn kickstart --cursor https://github.com/owner/repo/issues/123
```

The argument may be a full GitHub issue URL, an issue number for the current
repository, or a path to a markdown file. When a markdown file path is given,
kickstart uses that file as context (no GitHub fetch) and runs plan + implement;
AWP (branches, commits, PR) is not used when context is from a file.

### Cross-Repository Operations

By default, kickstart only supports implementing issues from the current
repository to ensure VCS operations work correctly. To implement issues from a
different repository, use `--allow-cross-repo`:

- **Allowed**: Cross-repo operations without AWP mode
- **Blocked**: Cross-repo operations with AWP mode (branches, commits, PRs)

Cross-repo workflows are useful when you write tickets in a private repository
but implement the functionality in a public repository. The changes are applied
to your current workspace, not the target repository.

See `dn kickstart --help` for all options.

## `dn auth` — Sign in to GitHub

Sign in to GitHub in the browser (device flow). The token is cached so
`dn kickstart`, `dn glance`, etc. can use it without re-prompting:

```bash
```

Requires `DN_GITHUB_DEVICE_CLIENT_ID` (or `GITHUB_DEVICE_CLIENT_ID`) set to your
GitHub OAuth App client ID. See [`docs/authentication.md`](authentication.md).

## `dn glance` — Project velocity & reports

Collects and renders lightweight project velocity reports from GitHub activity
(issues, pull requests, timelines). Useful for quick status checks and trend
analysis across a repository:

```bash
# Collect data for the current repo

# Render a report from collected data

# One-shot: collect and render
```

`dn glance` uses the same cached GitHub authentication as other subcommands. See
`dn glance --help` for available formats, time ranges, and filters.

## `dn prep` — Plan phase only

Runs only the plan phase (steps 1–3: resolve issue, VCS prep, plan phase):

```bash
# Create a plan file from a GitHub issue
dn prep https://github.com/owner/repo/issues/123
dn prep 123

# Create a plan file from a local markdown file (no GitHub fetch)
dn prep docs/spec.md

# Cross-repository plan (issue from different repo)
dn prep --allow-cross-repo https://github.com/private-org/backend-api/issues/123

# With a specific plan name
dn prep --plan-name my-feature https://github.com/owner/repo/issues/123
```

The argument may be a full GitHub issue URL, an issue number for the current
repository, or a path to a markdown file. When a markdown file path is given,
prep uses that file as context for the plan phase (no GitHub fetch).

### Cross-Repository Operations

By default, prep only supports issues from the current repository. Use
`--allow-cross-repo` to create plans for issues from other repositories:

- **Use Case**: Write tickets in private repo, implement in public repo
- **Safety**: Shows warning about cross-repo operation
- **Output**: Plan file created in current workspace context
- **Next Step**: Use `dn loop` with the generated plan file

The plan file path is printed for use with `dn loop`.

## `dn loop` — Loop phase only

Runs only the loop phase (steps 4–7: implement, completion, lint, artifacts,
validate):

```bash
# Requires plan file from prep

# With Cursor integration
```

Note: `dn loop` requires a plan file created by `dn prep`.

## `dn meld` — Merge sources and run plan phase

Merges one or more markdown sources (local files and/or GitHub issue URLs) into
a single DRY document with an Acceptance Criteria section, then runs the plan
phase (prep) using that content as context. The merged markdown is not written
to a file unless you pass `--output`; by default it is used only as context for
the plan phase and a plan file is produced.

```bash
# Single source: local file or issue URL
dn meld plan.md
dn meld https://github.com/owner/repo/issues/123

# Multiple sources; plan phase runs at the end
dn meld a.md b.md
dn meld -l sources.txt

# Write merged markdown to a file (also used as context)
dn meld a.md b.md -o plans/merged.md --plan-name merged

# Cursor mode: frontmatter + Cursor agent for plan phase
dn meld a.md https://github.com/owner/repo/issues/123 --cursor
```

Options include `--list, -l <path>`, `--output, -o <path>`,
`--plan-name <name>`, `--workspace-root <path>`, `--cursor, -c`, and
`--opencode`. See `dn meld --help` for details.

## `dn archive` — Derive a commit message from a plan file

Reads a plan file and prints a commit message (summary + body). With `--yolo`,
it commits staged files with that message and deletes the plan file:

```bash
# Print derived commit message

# Commit staged files with derived message, then delete the plan file
```

See `dn archive --help` for all options.
