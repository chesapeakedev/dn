# Subcommands

This document describes all `dn` CLI subcommands in detail. For installation and
authentication, see the project README.

## Global flags and output

You can pass **global flags** after any subcommand to control output style:

- **`--unattended`** or **`--ci`** – Force unattended mode (no spinner, minimal
  decoration, ASCII-friendly status).
- **`--no-color`** – Disable colors.
- **`--color`** – Enable colors even when stdout is not a TTY.

In CI, `dn` automatically sets `NO_COLOR` and runs in unattended mode. See
[Output and environment](output-and-environment.md) for NO_COLOR, FORCE_COLOR,
and how unattended mode is detected.

## Common argument formats

Several subcommands (`kickstart`, `prep`, `meld`) accept a flexible issue or
source argument. The following formats are recognized:

- **Full GitHub issue URL**: `https://github.com/owner/repo/issues/123`
- **Issue number** (current repo): `123`
- **Local markdown file path**: `docs/spec.md` or `plans/feature.md`

When a markdown file path is given, no GitHub fetch occurs and AWP mode is not
used.

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

# With Claude Code
dn kickstart --claude https://github.com/owner/repo/issues/123
```

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

### Kickstart without a ticket (suggest from list)

If you omit the issue URL/number and don't set `ISSUE`, kickstart reads the list
first; if it has unchecked items, you get one "Proceed with &lt;ref&gt;?" prompt
then the full run. If the list is empty, it can search the current repo for open
issues (and `plans/*.plan.md`), score them, write the list, then suggest the
first. After a successful run, you can answer "Mark &lt;ref&gt; done and
continue with next?" to chain to the next item.

## `dn todo` — Prioritized task list

Manages the user-level list at `~/.dn/todo.md` (issues and plan paths,
optionally scored).

```bash
# Mark first unchecked item done (and close GitHub issue if applicable)
dn todo done

# Mark a specific ref done (issue number, URL, or path)
dn todo done 42
dn todo done https://github.com/owner/repo/issues/42
dn todo done plans/auth.plan.md
```

When the ref is a GitHub issue, the issue is closed with a comment. Use this
after you’ve finished a ticket (e.g. PR merged) to keep the list and GitHub in
sync.

## `dn tidy` — Refresh and re-score the list

From a repo with a GitHub remote, fetches recent open issues and optional
`plans/*.plan.md`, scores them (Fibonacci readiness), and updates
`~/.dn/todo.md`. Use at the start of a session to seed or refresh the list. If
the scorer suggests merging issues, you’ll be prompted before any GitHub writes.
When `EDITOR` is set, opens the list in your editor after refresh.

```bash
dn tidy
dn tidy --limit 10
```

See `dn tidy --help` for all options.

## `dn auth` — Sign in to GitHub

Sign in to GitHub in the browser (device flow). The token is cached so
`dn kickstart`, `dn glance`, etc. can use it without re-prompting:

```bash
dn auth
```

Requires `DN_GITHUB_DEVICE_CLIENT_ID` (or `GITHUB_DEVICE_CLIENT_ID`) set to your
GitHub OAuth App client ID. See [`docs/authentication.md`](authentication.md).

## `dn glance` — Project velocity & reports

Collects and renders lightweight project velocity reports from GitHub activity
(issues, pull requests, timelines). Useful for quick status checks and trend
analysis across a repository:

```bash
dn glance
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

# With Claude Code
dn prep --claude https://github.com/owner/repo/issues/123
```

Cross-repository operations follow the same rules as `dn kickstart` — use
`--allow-cross-repo` to plan issues from a different repository. The plan file
path is printed for use with `dn loop`.

## `dn loop` — Loop phase only

Runs only the loop phase (steps 4–7: implement, completion, lint, artifacts,
validate):

```bash
dn loop --plan-file plans/issue-123.plan.md

# Or via environment variable
PLAN=plans/issue-123.plan.md dn loop

# With Cursor integration
dn loop --cursor --plan-file plans/issue-123.plan.md

# With Claude Code
dn loop --claude --plan-file plans/issue-123.plan.md
```

`dn loop` requires a plan file created by `dn prep`.

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

# Claude mode: no frontmatter + Claude Code for plan phase
dn meld a.md https://github.com/owner/repo/issues/123 --claude
```

Options include `--list, -l <path>`, `--output, -o <path>`,
`--plan-name <name>`, `--workspace-root <path>`, `--cursor, -c`, `--claude`, and
`--opencode`. See `dn meld --help` for details.

## `dn archive` — Derive a commit message from a plan file

Reads a plan file and prints a commit message (summary + body). With `--yolo`,
it commits staged files with that message and deletes the plan file:

```bash
dn archive plans/issue-123.plan.md

# Commit staged files with derived message, then delete the plan file
dn archive plans/issue-123.plan.md --yolo
```

See `dn archive --help` for all options.

## `dn fixup` — Address PR feedback

Fetches a pull request's description and review comments, creates a plan to
address the feedback, and implements fixes in your local workspace.

```bash
dn fixup https://github.com/owner/repo/pull/123

# With Cursor integration
dn fixup --cursor https://github.com/owner/repo/pull/123

# With Claude Code
dn fixup --claude https://github.com/owner/repo/pull/123
```

The PR URL can also be provided via the `PR_URL` environment variable. If
already on the correct branch, no VCS commands are executed. Changes remain
uncommitted for your review.

See `dn fixup --help` for all options.

## `dn issue` — Manage GitHub issues

Provides CRUD operations for GitHub issues from the terminal. All subcommands
operate on the current repository (detected from the git remote).

```bash
dn issue list                              # List open issues
dn issue list --state closed --limit 10    # Closed issues, max 10
dn issue list --label bug                  # Filter by label
dn issue show 123                          # Show details and comments
dn issue show 123 --no-comments            # Details only
dn issue create --title "Bug" --body-file report.md
dn issue edit 123 --title "New title"
dn issue edit 123 --add-label bug
dn issue close 123                         # Close as completed
dn issue close 123 --reason not_planned    # Close as not planned
dn issue close 123 --comment "Fixed in #456"
dn issue reopen 123
dn issue comment 123 --body-file update.md
dn issue comment 123 --body-stdin          # Pipe body from stdin
```

All subcommands support `--json` for machine-readable output and `--help` for
per-subcommand options. Issue references accept a number (`123`), `#123`, or a
full URL.
