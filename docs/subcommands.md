# Subcommands

This document describes all `dn` CLI subcommands in detail. For installation and
authentication, see the project README.

## `dn kickstart` — Full workflow

Runs the complete kickstart workflow (plan + implement phases):

```bash
# Default mode: Apply changes locally

# Issue number shorthand (infers URL from current repo remote)

# AWP mode: Full workflow with branches and PR

# With Cursor integration
```

The issue argument may be a full GitHub issue URL or an issue number for the
current repository. If the URL points to a different repository than the current
workspace, kickstart exits with an error. See `dn kickstart --help` for all
options.

## `dn auth` — Sign in to GitHub

Sign in to GitHub in the browser (device flow). The token is cached so
`dn kickstart`, `dn glance`, etc. can use it without re-prompting:

```bash

```

Requires `DN_GITHUB_DEVICE_CLIENT_ID` (or `GITHUB_DEVICE_CLIENT_ID`) set to your
GitHub OAuth App client ID. See
[`docs/authentication.md`](authentication.md).

## `dn glance` — Project velocity & reports

Collects and renders lightweight project velocity reports from GitHub activity
(issues, pull requests, timelines). Useful for quick status checks and trend
analysis across a repository:

```bash
# Collect data for the current repo

# Render a report from collected data

# One-shot: collect and render
```

`dn glance` uses the same cached GitHub authentication as other subcommands.
See `dn glance --help` for available formats, time ranges, and filters.

## `dn prep` — Plan phase only

Runs only the plan phase (steps 1–3: resolve issue, VCS prep, plan phase):

```bash
# Create a plan file

# Issue number shorthand (infers URL from current repo remote)

# With a specific plan name
```

The issue argument may be a full GitHub issue URL or an issue number for the
current repository. If the URL points to a different repository than the current
workspace, prep exits with an error. The plan file path is printed for use with
`dn loop`.

## `dn loop` — Loop phase only

Runs only the loop phase (steps 4–7: implement, completion, lint, artifacts,
validate):

```bash
# Requires plan file from prep

# With Cursor integration
```

Note: `dn loop` requires a plan file created by `dn prep`.

## `dn meld` — Merge and normalize markdown sources

Merges multiple markdown sources (local files and/or GitHub issue URLs) into a
single DRY document with an Acceptance Criteria section:

```bash
# Merge files to stdout

# From a newline-separated list, write to file

# Cursor mode: add YAML frontmatter (name, overview, todos, isProject)
```

Options include `--list, -l <path>`, `--output, -o <path>`, `--cursor, -c`, and
`--opencode`. See `dn meld --help` for details.

## `dn archive` — Derive a commit message from a plan file

Reads a plan file and prints a commit message (summary + body). With `--yolo`, it
commits staged files with that message and deletes the plan file:

```bash
# Print derived commit message

# Commit staged files with derived message, then delete the plan file
```

See `dn archive --help` for all options.
