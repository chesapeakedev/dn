---
name: dn
description: Use when interacting with the `dn` CLI (GitHub issues, kickstart workflows, VCS sync, project velocity). Covers all subcommands, flag conventions, agent harness selection, and env vars. Do NOT use for general TypeScript/Deno questions unrelated to dn.
---

# dn

`dn` is a Deno-based CLI for GitHub issue-driven development workflows. It is
the primary interface to this repository's workflows. Prefer it over ad-hoc
scripts or direct API calls when preparing workspaces, iterating on plans, or
coordinating changes.

For the installable skill roster and specialized workflows, see
`.agents/skills/README.md`. In particular, use `milestone-plan` for epics,
roadmap slices, and other multi-issue planning work.

## Quickstart

```bash
dn                    # list subcommands
dn <subcommand> -h    # help for a specific subcommand
```

## Project config (`dn.json`)

At the start of a session, read repository `dn.json` (workspace root, or walk
up). If `harness_hints` is present, apply it: a map of string keys to string
values with project-specific operator notes. Keys are freeform. Honor those
notes for this checkout. Do not put secrets in `harness_hints`.

## Global Flags

| Flag                    | Effect                                                           |
| ----------------------- | ---------------------------------------------------------------- |
| `--agent <agent>`       | `<harness>:<model>` (harness-only or optional `:<thinking>`)     |
| `--context-file <path>` | Include a file in agent prompt context (repeatable)              |
| `--unattended` / `--ci` | Non-interactive (no spinners, minimal decoration)                |
| `--trace`               | Live-stream agent harness output (default in CI/unattended)      |
| `--no-trace`            | Suppress live agent stream (default in attended TTY)             |
| `--no-color`            | Disable ANSI color                                               |
| `--color`               | Force ANSI color even on non-TTY                                 |
| `--json`                | JSON output (supported by most subcommands)                      |

### Agent harness selection priority

1. Explicit `--agent <harness>:<model>` (global or on the subcommand)
2. `DN_AGENT` using the same value form
3. Environment toggle (`CURSOR_ENABLED=1`, `CLAUDE_ENABLED=1`,
   `CODEX_ENABLED=1`, `COPILOT_ENABLED=1`)
4. Project `dn.json` / `.github/dn/config.json` harness name
5. Default: OpenCode

## Token resolution order

1. `GITHUB_TOKEN` (or `DANGEROUS_GITHUB_TOKEN`) env var
2. `gh auth token` (preferred interactive path: `gh auth login`)
3. `dn auth` cached device-flow token (`~/.config/dn/`) (complementary)

## Common env vars

- `ISSUE` — fallback issue URL/number for `kickstart` and `meld`
- `WORKSPACE_ROOT` — project root directory
- `GITHUB_TOKEN` — GitHub personal access token
- `PR_URL` — PR URL for `fixup`
- `PLAN` — path to plan file for `loop`

## Repeatable flows

Default publish mode is local (`none`). Do not use `--awp` / `--publish pr`
unless the user asked for a pull request. Do not stack another kickstart on
uncommitted kickstart work.

When you are an **outer IDE harness**, implement with the CLI, then **ask**
whether to commit. If the user says yes, you write the commit with the repo
VCS and omit `*.plan.md`. Do not auto-run `dn land`.

`dn land` is for attended CLI, CI, denoise/device-runners, `--issue-testplan`,
RFC land, or when the user names `dn land`. `dn sync` publishes to trunk; it
is not a commit step.

| Flow | When | Commands |
| --- | --- | --- |
| kickstart | Whole issue, no planning checkpoint | `dn kickstart <issue>`, then ask to commit |
| meld → loop | Review plan between phases | `dn meld` → `dn loop`, then ask to commit |
| land | CLI, CI, denoise, or user named it | `dn land` / `dn land --single <plan>` |

`meld` is **not** a post-loop step. After `fixup`, ask before committing (same
as kickstart).

### From an issue URL

The common prompt is `{github issue url} can you kickstart this?` Resolve argv.
Do not quiz the user for flags the CLI already defaults.

1. Pass the **full issue URL** as the positional argument (not a bare number).
2. Compare the URL's `owner/repo` to this workspace
   (`gh repo view --json nameWithOwner -q .nameWithOwner`). If they differ,
   pass `--allow-cross-repo` (`-A`). Do not ask. Mention it in the summary. If
   you cannot detect the workspace repo, pass `-A` for a full URL anyway.
3. Extra guidance in the user message besides the URL → `--steer "…"`.
4. Named or attached files → `--context-file` (repeatable).
5. Leave the rest at CLI defaults unless the user asked (`--publish`/`--awp`,
   `--agent`, `--cursor-cloud`, `--sandbox`, `--milestone`, `--skip-plan`).
6. `/pull/` URL → `dn fixup`. Local `.md` → kickstart that file.
7. If `plans/*.plan.md` exists and the tree is dirty, stop and ask before
   stacking another kickstart.

## Subcommands

| Subcommand     | Description                                                                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dn kickstart` | Full workflow: plan + implement. Takes a GitHub issue URL/number, or local `.md` file. Supports AWP mode (branches, commits, PRs), milestone stacks, cross-repo. |
| `dn meld`      | Plan phase. One issue, local Markdown, or combined sources. Supports `--target` (README.md, AGENTS.md, plans/, github:). |
| `dn loop`      | Loop phase (steps 4-7). Implement, completion, lint, artifacts, validate. Requires a plan file. |
| `dn fixup`     | Address PR feedback. Fetches PR description + review comments, creates plan, implements fixes locally. |
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
| `dn sync`      | Rebase current stack onto remote trunk and publish it. Optional `dn.json` `sync.preflight`. |
| `dn todo done` | Mark first unchecked item done (or specific ref), close GitHub issue if applicable                                                |
| `dn tidy`      | Groom todo list: re-fetch open issues, re-score, update `~/.dn/todo.md`                                                           |
| `dn release`   | GitHub release management: `create`, `list`, `view`, `edit`, `delete`                                                             |

### Utilities

| Subcommand         | Description                                                          |
| ------------------ | -------------------------------------------------------------------- |
| `dn auth`          | Complementary browser login (`login`/`status`/`logout`). Prefer `gh auth login`. |
| `dn context check` | Inspect inherited AGENTS.md context chain for a file/directory       |

## Few-shot examples

```bash
# print help
dn

# End-to-end issue (IDE: then ask before committing)
dn kickstart 123

# Reviewable plan, then implement
dn meld 123
dn loop plans/issue-123.plan.md

# CLI/CI close-out
dn land plans/issue-123.plan.md
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

Trunk-landing workflow: rebase the current stack onto remote trunk and publish
that HEAD to trunk. Not a pull-request workflow. Other local branches and
bookmarks are left alone.

```bash
make sync   # this repo: deno run of local cli/main.ts sync
dn sync     # if dn is on PATH
```

Optional quality gates come from `dn.json` `sync.preflight` (this repo: `make
lint` then `make tests`). Repositories without that block run no lint or test
command. Trunk defaults to the Git remote HEAD, then local `main`, or
`sync.trunk`.

Sapling: `sl pull --rebase -d <trunk>` → conditional `sl restack` → conditional
`sl push --to <trunk>`. Git: fetch trunk, rebase onto `FETCH_HEAD`, push
`HEAD:<trunk>` when commits remain.

Use `make sync` / `dn sync` when you sit down (to pull latest) and before you
get up (to push your work). To share a feature branch without landing it, use
the VCS directly.

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
