---
name: dn
description: Use when interacting with the `dn` CLI (GitHub issues, kickstart workflows, VCS sync, project velocity). Covers all subcommands, flag conventions, agent harness selection, and env vars. Do NOT use for general TypeScript/Deno questions unrelated to dn.
---

# dn

`dn` is a Deno-based CLI for GitHub issue-driven development workflows. It is
the primary interface to this repository's workflows. Prefer it over ad-hoc
scripts or direct API calls when preparing workspaces, iterating on plans, or
coordinating changes.

## Quickstart

```bash
dn                    # list subcommands
dn <subcommand> -h    # help for a specific subcommand
```

## Global Flags

| Flag                    | Effect                                                           |
| ----------------------- | ---------------------------------------------------------------- |
| `--agent <name>`        | Agent harness: `opencode` (default), `cursor`, `claude`, `codex` |
| `--opencode`            | Alias for `--agent opencode`                                     |
| `--cursor` / `-c`       | Alias for `--agent cursor`                                       |
| `--claude`              | Alias for `--agent claude`                                       |
| `--codex`               | Alias for `--agent codex`                                        |
| `--unattended` / `--ci` | Non-interactive (no spinners, minimal decoration)                |
| `--trace`               | Live-stream agent harness output (default in CI/unattended)      |
| `--no-trace`            | Suppress live agent stream (default in attended TTY)             |
| `--no-color`            | Disable ANSI color                                               |
| `--color`               | Force ANSI color even on non-TTY                                 |
| `--json`                | JSON output (supported by most subcommands)                      |

### Agent harness selection priority

1. Explicit `--agent <name>` (global flag)
2. Legacy per-command flag (`--cursor`, `--claude`, `--codex`, `--opencode`)
3. Environment toggle (`CURSOR_ENABLED=1`, `CLAUDE_ENABLED=1`,
   `CODEX_ENABLED=1`)
4. Default: OpenCode

## Token resolution order

1. `GITHUB_TOKEN` (or `DANGEROUS_GITHUB_TOKEN`) env var
2. `dn auth` cached device-flow token (`~/.dn/`)
3. `gh auth token` (shell out to GitHub CLI)

## Common env vars

- `ISSUE` — fallback issue URL/number for `kickstart` and `prep`
- `WORKSPACE_ROOT` — project root directory
- `GITHUB_TOKEN` — GitHub personal access token
- `PR_URL` — PR URL for `fixup`
- `PLAN` — path to plan file for `loop`

## Subcommands

### Workflow lifecycle

Issue-driven work uses these phases (not a rigid single pipeline):

| Phase | Commands |
| --- | --- |
| Plan | `prep` *or* `meld` (meld is many-to-one and can replace prep); `kickstart` includes plan |
| Implement | `loop` / `kickstart` / `fixup` |
| Close out | `land` (optional `--issue-testplan` upserts `## Test Plan` on the linked GitHub issue) |
| Publish trunk | `sync` (optional; distinct from `dn land`) |

`meld` is **not** a post-loop step. After `fixup`, run `dn land` separately to
commit.

| Subcommand     | Description                                                                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dn kickstart` | Full workflow: plan + implement. Takes a GitHub issue URL/ number, or local `.md` file. Supports AWP mode (branches, commits, PRs), milestone stacks, cross-repo. |
| `dn prep`      | Plan phase only (steps 1-3). Resolves issue, VCS prep, creates a `.plan.md`. `--update-issue` fills empty template sections.                                      |
| `dn loop`      | Loop phase (steps 4-7). Implement, completion, lint, artifacts, validate. Requires a plan file.                                                                   |
| `dn fixup`     | Address PR feedback. Fetches PR description + review comments, creates plan, implements fixes locally.                                                            |
| `dn meld`      | Merge markdown sources + plan into DRY input (many-to-one plan phase). Supports `--target` (README.md, AGENTS.md, plans/, github:).                               |
| `dn land`      | Close out work into VCS commits. `--issue-testplan` updates the linked GitHub issue; `--single` derives one commit message from the plan title + truncated overview/body (no agent). |

### GitHub issue management

| Subcommand              | Description                                                                                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `dn issue list`         | List issues with `--state`, `--label`, `--limit`, `--json`                                                        |
| `dn issue show`         | Show issue details + comments + relationships (parent, sub- issues, blockers)                                     |
| `dn issue create`       | Create issue with `--title`, `--body-file`, `--body-stdin`, `--label`                                             |
| `dn issue edit`         | Edit title, body, or add labels                                                                                   |
| `dn issue close`        | Close with optional `--comment` and `--reason` (completed/ not_planned)                                           |
| `dn issue reopen`       | Reopen with optional `--comment`                                                                                  |
| `dn issue comment`      | Add comment via `--body-file` or `--body-stdin`                                                                   |
| `dn issue relationship` | Manage relationships: `add/remove blocked-by`, `add/remove sub-issue`, `reprioritize sub-issue`, `mark-duplicate` |

Use `--repo owner/repo` for cross-repo operations. Use `dn issue show <ref>`
before editing to confirm current context. Commenting is the safe default
(append-only); only edit the issue body when explicitly asked to replace the
description.

### Repository & project management

| Subcommand          | Description                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| `dn init stack`     | Create prioritized task list from GitHub milestone. Generates `plans/...stack.md` and `.stack.json`. |
| `dn init workflows` | Install canonical GitHub Actions workflow templates                                                  |
| `dn init agents`    | Update AGENTS.md with dn instructions                                                                |
| `dn glance`         | Project velocity: collects issues/commits activity, compares to prior window, renders summary        |
| `dn peek`           | Suggest next issues: heuristic ranking of open issues                                                |

### Workflow templates

| Subcommand              | Description                                                   |
| ----------------------- | ------------------------------------------------------------- |
| `dn workflow run`       | Trigger `workflow_dispatch` or `repository_dispatch` events   |
| `dn workflows list`     | Report installed template status (missing, current, outdated) |
| `dn workflows install`  | Write missing canonical workflow templates                    |
| `dn workflows update`   | Write missing + replace outdated templates                    |
| `dn workflows validate` | Check template checksums and required permissions             |

### VCS & housekeeping

| Subcommand     | Description                                                                                                                       |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `dn sync`      | Sapling push/pull workflow: `make lint` → `sl pull --rebase -d main` → conditional `sl restack` → conditional `sl push --to main` |
| `dn todo done` | Mark first unchecked item done (or specific ref), close GitHub issue if applicable                                                |
| `dn tidy`      | Groom todo list: re-fetch open issues, re-score, update `~/.dn/todo.md`                                                           |
| `dn release`   | GitHub release management: `create`, `list`, `view`, `edit`, `delete`                                                             |

### Utilities

| Subcommand         | Description                                                          |
| ------------------ | -------------------------------------------------------------------- |
| `dn auth`          | Sign in to GitHub via browser device flow. Caches token in `~/.dn/`. |
| `dn context check` | Inspect inherited AGENTS.md context chain for a file/directory       |

## Few-shot examples

```bash
# print help
dn

# Prepare a repository or workspace before making changes
dn prep

# Iterate on an existing plan or task until convergence
dn loop

# Combine or reconcile outputs from multiple iterations
dn meld

# Land completed work from a plan
dn land --single plans/my-feature.plan.md

# Create a new GitHub issue from a conversation
dn issue create --title "Brief title" --body-file description.md

# Create a new GitHub issue in a different repository
dn issue create --repo owner/repo --title "Brief title" --body-file description.md

# Read an issue before updating it
dn issue show 123

# Add a comment with updated understanding (append-only, safe default)
dn issue comment 123 --body-file update.md

# Replace the issue body (only when explicitly asked)
dn issue edit 123 --body-file revised.md

# Trigger workflow_dispatch or repository_dispatch (canonical dn templates)
dn workflow run release.yml --ref main -f tag=v1.0.0
echo '{"schema_version":"1.0","dispatch_id":"'"$(uuidgen)"'","milestone":"1"}' \
  | dn workflow run dn.init_stack --repo owner/repo --json
```

## Issue management guidelines

- **Create** new issues when you discover bugs, identify follow-up work, or the
  user asks you to file a ticket.
- **Comment** on existing issues to append refined understanding, progress
  updates, or conversation summaries. This is the safe default.
- **Edit** an existing issue's body only when the user explicitly asks to
  replace the description.
- Use `dn issue show <ref>` before editing to confirm current context.
- Use `--body-file <path>` for longer content and `--body-stdin` for short
  updates.

## `make sync` / `dn sync`

The primary push/pull workflow:

```bash
make sync   # compiles dn, then runs dn sync
dn sync     # if dn is on PATH
```

This runs: `make lint` → `sl pull --rebase -d main` → conditional `sl restack` →
conditional `sl push --to main`.

Use `make sync` when you sit down (to pull latest) and before you get up (to
push your work).

## SDK (`sdk/mod.ts`)

Published on JSR as `@chesapeake/dn`. Provides programmatic access to:

- **`Auth`** — GitHub and Google OAuth handlers, session management
- **`GitHub`** — Issue CRUD, issue relationships, workflow dispatch, VCS
  detection, token resolution
- **`Archive`** — Commit message derivation (`deriveCommitMessage`,
  `formatCommitMessage`)
- **`Meld`** — Markdown merge, normalize, deduplicate (`mergeMarkdown`,
  `deduplicateBlocks`)
- **`Workflows`** — Template install, validate, dispatch payload validation
