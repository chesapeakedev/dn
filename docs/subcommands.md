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

## `dn context` — Inspect inherited `AGENTS.md` context

Calculates the inherited `AGENTS.md` chain for a file or directory using the
basic Codex discovery order documented by OpenAI:

- Checks global `CODEX_HOME` (or `~/.codex`) for `AGENTS.override.md`, then
  `AGENTS.md`
- Walks from the detected project root down to the target directory
- In each directory, prefers `AGENTS.override.md` over `AGENTS.md`
- Skips empty files
- Joins discovered files with blank lines
- Reports the full byte size and the subset that fits within a configurable byte
  budget (`32768` by default)

```bash
# Basic size check
dn context check cli/main.ts

# Compare against a larger byte limit
dn context check cli/main.ts --max-bytes 65536

# Machine-readable output
dn context check cli/main.ts --json

# Estimate included prompt tokens with Anthropic's token counting API
dn context check cli/main.ts --claude-tokens
```

`--claude-tokens` requires `ANTHROPIC_API_KEY` and uses Anthropic's
`/v1/messages/count_tokens` endpoint. The returned count is an estimate for the
included context, not the full undiscarded chain, when the byte limit truncates
later files.

## `dn init` — Initialize repository context

Manages repository setup with `stack`, `build`, `workflows`, and `agents`.

### `dn init build` — Install build automation workflows

Installs the same canonical GitHub Actions support as `dn init workflows`,
including the daily kickstart workflow. Use it as the short setup path when a
repo wants dn-managed automation:

```bash
dn init build --agent claude
gh secret set ANTHROPIC_API_KEY
gh variable set DN_DAILY_KICKSTART_MILESTONE --body 42
dn init stack 42
# Commit .github/dn/, .github/workflows/, and plans/owner_repo_42.stack.md
```

The daily workflow runs:

```bash
dn --agent <configured> kickstart --awp --milestone <milestone> --once
```

It processes exactly one unchecked item from the committed milestone stack file
per run. Scheduled runs read `DN_DAILY_KICKSTART_MILESTONE`; manual
`workflow_dispatch` runs can pass a `milestone` input instead.

### `dn init workflows` — Install canonical workflow templates

Installs canonical dn GitHub Actions workflows plus repo agent configuration:

- `.github/workflows/dn-*.yml` — dispatch and scheduled workflows
- `.github/dn/config.json` — preferred agent for all dn workflows in this repo

Choose your agent once (same value for every dispatch):

```bash
dn init workflows --agent claude
gh secret set ANTHROPIC_API_KEY
# Commit .github/dn/config.json and the installed workflows
```

Supported agents: `opencode` (default), `cursor`, `claude`, `codex`.

```bash
dn init workflows
dn init build
dn init workflows --agent opencode --dry-run
dn init workflows --json
dn workflows install --agent cursor
dn workflows update
dn workflows validate --json
```

`dn workflows install` only writes missing workflow files. Use
`dn workflows update` to refresh outdated templates and the install script.
Passing `--agent` creates or updates `.github/dn/config.json`.

### `dn init agents` — Update AGENTS.md or install agent skill

Without flags, updates or creates `AGENTS.md` with dn workflow instructions:

```bash
dn init agents
```

Pass `--skill` to install native skill files for one explicitly selected
supported agent. `--agent` is required with `--skill`.

```bash
dn init agents --skill --agent codex
dn init agents --skill --agent claude
dn init agents --skill --agent opencode
dn init agents --skill --agent cursor
dn init agents --skill --agent codex --scope user
dn init agents --skill --agent claude --dry-run --json
```

Supported skill agents: `codex`, `claude`, `opencode`, `cursor`.

Repo-scope installs write:

- `codex`, `opencode`: `.agents/skills/dn/SKILL.md` and
  `.agents/skills/dn/agents/openai.yaml`
- `claude`: `.claude/skills/dn/SKILL.md`
- `cursor`: `.cursor/rules/dn.mdc`

User-scope installs write:

- `codex`, `opencode`: `~/.agents/skills/dn/SKILL.md` and
  `~/.agents/skills/dn/agents/openai.yaml`
- `claude`: `~/.claude/skills/dn/SKILL.md`

Cursor skill installation is repo-scoped. Managed files are idempotent; existing
unmanaged files are left untouched unless `--force` is passed. Use `--dry-run`
to inspect planned writes, skips, and conflicts without changing files.

### `dn init stack` — Initialize stack from GitHub milestone

Creates a prioritized task list from a GitHub milestone. The command:

1. Fetches the milestone and all its open issues from GitHub
2. Scores each issue for kickstart readiness (Fibonacci: 1, 2, 3, 5, 8)
3. Creates `plans/{owner}_{repo}_{milestone-number}.stack.md` with sorted tasks
   (easiest first)
4. Commits stack artifacts in CI (`--publish direct`) or prints manual commit
   steps

```bash
# Using milestone number
dn init stack 42

# Using full milestone URL
dn init stack https://github.com/owner/repo/milestone/3

# Refresh scores/order while preserving completed checklist items
dn init stack 42 --refresh

# Replace the stack from scratch (destructive)
dn init stack 42 --overwrite --yes

# Commit stack files to the default branch explicitly
dn init stack 42 --refresh --publish direct
```

#### Stack File Format

The generated stack file includes a system prompt for agents, prioritized tasks
sorted by score (easiest first), and any disqualified issues:

```markdown
---
milestone: 42
repo: owner/repo
updated: 2026-04-07
---

<!--
  SYSTEM: This file is a milestone stack generated by `dn init stack`.
  Agents should process issues in order (easiest first).
  Each issue should be kicked off using: dn kickstart #<number> or a full issue URL.
-->

# Milestone: Q2 Features

## Prioritized Tasks (easiest first)

- [ ] 1 #45 Add login button
- [ ] 2 #42 Fix auth redirect
- [ ] 3 #41 Update API docs

## Disqualified (not ready for kickstart)

- [ ] _#50 Complex refactor_
  - Reason: Missing acceptance criteria
```

The system prompt tells agents how to use the file without external context.
Disqualified issues appear only when the LLM determines they're not ready for
kickstart (e.g., missing acceptance criteria).

#### Using with Kickstart

Work on milestone tasks using `--milestone`:

```bash
# Work on the first unchecked task in milestone 42
dn kickstart --milestone 42

# Full workflow with AWP
dn kickstart --awp --milestone 42

# Run every remaining unchecked stack item in order (no y/n between tasks)
dn kickstart --milestone 42 --complete

# Run exactly one unchecked stack item for CI
dn kickstart --awp --milestone 42 --once
```

`--complete` and `--once` must be used with `--milestone` and **without** an
issue argument or `ISSUE` env var. `--complete` runs every remaining stack item
in order. `--once` runs the first unchecked stack item, marks that one item
done, and exits. Both flags skip only the milestone queue prompts in the
kickstart CLI; plan and implement phases can still prompt internally (for
example existing plan continuation or plan naming). Use `--saved-plan` or other
flags as needed for unattended agent runs.

The milestone-aware kickstart reads from
`plans/{owner}_{repo}_{milestone}.stack.md` and uses the first unchecked item as
the task. Numeric milestone arguments resolve against the current repository;
full milestone URLs resolve against the repository in the URL.

#### Denoise Integration

For stable machine-readable stack artifacts and UI integration guidance, see
[denoise-integration.md](denoise-integration.md).

Commit the plan file to your repository to "link" it to the GitHub milestone:

```bash
sl add plans/owner_repo_42.stack.md plans/owner_repo_42.stack.json
sl commit -m "Add owner/repo milestone 42 stack"
sl push
```

When the plan file is in the repo, external tools (like Denoise) can read it to:

1. Discover the milestone
2. Show a button to trigger kickstart on the next unchecked task
3. Execute `dn kickstart --awp --milestone <num-or-url> --once` for that issue

To refresh the plan (re-fetch issues and re-score), run:

```bash
dn init stack 42 --refresh
```

See `dn init stack --help` for all options.

## `dn workflows` — Run and manage GitHub Actions workflows

Dispatches `workflow_dispatch` / `repository_dispatch` events, executes
canonical workflows inside Actions, and manages installed templates.

### Running workflows

Canonical dispatch templates (`dn.init_stack`, `dn.prep_issue_plan`,
`dn.kickstart_issue`) use `repository_dispatch` and are auto-detected from the
shipped manifest. `dn.daily_kickstart` uses schedule and `workflow_dispatch`.
Other workflows with `on.workflow_dispatch` use the same path as
`gh workflow run`.

```bash
dn workflows dispatch release.yml
dn workflows dispatch triage.yml --ref my-branch
dn workflows dispatch triage.yml -f name=scully -f greeting=hello
echo '{"name":"scully"}' | dn workflows dispatch triage.yml --json
dn workflows dispatch smoke.yml --repo owner/repo

# repository_dispatch (canonical dn templates)
echo '{"schema_version":"1.0","dispatch_id":"'"$(uuidgen)"'","milestone":"1"}' \
  | dn workflows dispatch dn.init_stack --repo owner/repo --json
dn workflows dispatch dn-prep-issue-plan.yml --repo owner/repo --json '<payload>'
```

Options for `dispatch`:

- `--repo`, `-R` — target `owner/repo` (default: current remote)
- `--ref`, `-r` — branch or tag containing the workflow file (default: default
  branch)
- `--dispatch` — force `repository` or `workflow` when both triggers exist
- `--wait` — poll until a `repository_dispatch` run appears (opt-in)
- `-f`, `--raw-field` — string workflow input (`workflow_dispatch` only)
- `-F`, `--field` — string input; `@path` reads file contents
- `--json` — JSON object from stdin: workflow `inputs` or `client_payload`

For `workflow_dispatch`, the command prints the created run URL when the API
returns it. For `repository_dispatch`, the API returns 204 with no run id; the
command prints `event_type`, `dispatch_id`, and a polling hint such as
`gh run list --repo owner/repo --event repository_dispatch`. Interactive
workflow and input prompts are not implemented yet.

### Executing inside GitHub Actions

`dn workflows exec <template-id>` is the runner-side command used by
`chesapeakedev/dn-action`. It validates the GitHub event, repository agent
configuration, and required credential before installing the agent harness and
running the mapped dn command.

```bash
dn workflows exec dn.kickstart_issue
dn workflows exec dn.kickstart_issue --validate-only
```

The command writes validation and execution details to `GITHUB_STEP_SUMMARY`.
`--validate-only` stops before agent installation and command execution.

### Managing templates

Manage workflow templates and report machine-readable status for integrations:

```bash
dn workflows list
dn workflows install
dn workflows update
dn workflows validate
dn workflows validate --json
```

Subcommands:

- `list` reports each canonical template as `missing`, `current`, or `outdated`
- `install` writes missing templates only
- `update` writes missing templates and replaces outdated templates
- `validate` checks installed template checksums and required permission lines

All subcommands support `--json`; `install` and `update` also support
`--dry-run`.

## `dn glance` — Project velocity & reports

Collects GitHub activity (issues opened/closed + commits on the default branch),
compares it to the **prior window of equal length**, and renders a boxed summary
including per-day rates (`issues/day`, `commits/day`), trend glyphs (**↑ / ↓ /
→**) or unattended markers (`[UP]` / `[DOWN]` / `[FLAT]`), **net issue flow**
(`opens − closes`), grouping by primary label for issue lists, relative
timestamps, truncated titles, and contributor share with ASCII micro-bars.

```bash
dn glance
dn glance --days 14
dn glance --compact --no-urls
```

Standalone entry (parity with CLI flags): run `glance/main.ts` with `--days`,
`--compact`, and `--no-urls`.

See [Global flags and output](#global-flags-and-output) for `--no-color`,
`--color`, and `--unattended` / `--ci`, which affect Unicode vs ASCII and ANSI
styling (`dn` bootstraps them before glance runs).

Authentication matches other GitHub-backed commands (**`dn auth`**,
**`gh auth login`**, or **`GITHUB_TOKEN`**).

## `dn peek` — Suggested next open issues (heuristic)

Ranks recent **open** issues with a fixed scoring model (issue age, assignees,
bug-like labels, staleness vs `updatedAt`, and comment counts). Uses GraphQL
**`listIssues`** paging only—**no LLM**; **`kickstart` Fibonacci scoring is not
invoked**.

```bash
dn peek                       # Top 3 (default), up to 100 candidates
dn peek --limit 5             # Top five
dn peek --fetch 200           # Widen candidate pool (1–500 cap)
dn peek --verbose --no-urls   # Explain score boosts; omit URLs
```

Output includes a heuristic **score** line per issue and optional `--verbose`
boost breakdown. Respect global color/unattended flags the same way as
`dn glance`.

## `dn sync` — Git/Sapling: lint, rebase, publish

Runs the “sync with trunk” flow from `AGENTS.md` (the same flow as `make sync`
in this repo). It prefers Sapling when both VCS tools recognize the checkout,
then falls back to Git. **Prerequisites:** Git or Sapling (`sl`), **`make`** on
PATH, and **Deno** (what `make lint` already uses).

**Steps (in order, fail-fast):**

1. **`make lint`** at the repository root (format + typecheck + lint), unless
   **`--skip-lint`** is passed.
2. Rebase the current work onto remote **`main`**.
3. Publish the rebased local commits directly to remote **`main`**, or skip the
   push when no local commits remain.

Sapling uses **`sl pull --rebase -d main`**, conditionally runs **`sl restack`**
for `children(obsolete()) - obsolete()`, and publishes with
**`sl push --to main`**. Git resolves the remote tracked by local **`main`**
(falling back to **`origin`**), fetches **`main`**, rebases onto
**`FETCH_HEAD`**, and publishes with **`git push <remote> HEAD:main`**. Git does
not need an equivalent restack step.

**Credentials:** `dn auth` configures the GitHub API token (`dn issue`, etc.).
Git and Sapling pushes use repository credentials (**HTTPS credential helper**,
**`gh auth`** HTTPS, or SSH) — failures usually point at remote auth, not the
OAuth cache.

From a subdirectory of the checkout:

```bash
dn sync --workspace-root /path/to/checkout
```

`make sync` runs the repository lint target once, then invokes the local
TypeScript entrypoint with `sync --skip-lint` so it does not repeat the same
validation.

Troubleshooting:

- **VCS not found** — install Git or Sapling and ensure it is on PATH.
- **merge/rebase aborted** — fix conflicts reported by the VCS, then re-run
  **`dn sync`**.
- **push auth errors** — configure remote credentials (**`gh auth login`**, SSH
  remote, or a helper).
- **`make`** missing — install **make**; on this repo **`make configure`**
  installs `dn`; **`make sync`** runs the local TypeScript entrypoint via
  **`deno run`**.

See also [`AGENTS.md`](../AGENTS.md) (Workflow: `make sync`) and `cli/sync.ts`.

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
dn --agent claude prep https://github.com/owner/repo/issues/123

# With Codex CLI
dn --agent codex prep https://github.com/owner/repo/issues/123
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
dn --agent cursor loop --plan-file plans/issue-123.plan.md

# With Claude Code
dn --agent claude loop --plan-file plans/issue-123.plan.md

# With Codex CLI
dn --agent codex loop --plan-file plans/issue-123.plan.md
```

`dn loop` requires a plan file created by `dn prep`.

## `dn meld` — Merge sources and run contextual planning

Merges one or more markdown sources (local files and/or GitHub issue URLs) into
a single DRY document with an Acceptance Criteria section, then runs the shared
prep/plan-phase agent harness on that markdown.

- **Merged input (`--output`, `-o`)** — Intermediate markdown persisted for
  reuse. Omitting `-o` still keeps a temp snapshot used only as planner context.
- **`--target`** — Planner output (`README.md`, `AGENTS.md`, `CONTRIBUTING.md`,
  arbitrary `.md`, `plans/*.plan.md`, `github:issue:<ref>`,
  `github:comment:<ref>`). Omit for the historical default (`plans/*.plan.md`).
- **`--overwrite` / confirmations** — Overwriting or creating files prompts on a
  TTY; unattended merges need `--yes` or `DN_YES=1`; GitHub mutations also
  require `--yes` when non-interactive.
- **`--list`, `-l`** — Expects newline-separated paths (POSIX style). Paths may
  contain commas safely.
- **`prep` vs `meld`** — `prep` stays the single-issue shortcut while `meld`
  excels at merging many sources before planning; internals now share the same
  orchestrator.

```bash
# Single source: local file or issue URL (default plan naming)
dn meld plan.md
dn meld https://github.com/owner/repo/issues/123

# Multiple sources; planner runs afterward
dn meld a.md b.md
dn meld -l sources.txt

# Write merged markdown to disk (still distinct from planner output targets)
dn meld a.md b.md -o plans/merged.md --plan-name merged

# Update AGENTS.md with summarized guidance (merge mode by default)
dn meld research.md ops-notes.md --target AGENTS.md

# Append a synthesized GitHub comment (requires GitHub credentials)
dn meld handoff.md --target github:comment:123 --dry-run

# Cursor / Claude / Codex harness parity with prep
dn meld a.md https://github.com/owner/repo/issues/123 --cursor
dn meld a.md https://github.com/owner/repo/issues/123 --claude
dn --agent codex meld a.md https://github.com/owner/repo/issues/123
```

Flags mirror `dn prep`'s unattended behavior for agent harness selection; see
`dn meld --help` for `--target`, `--overwrite`, `--dry-run`, `--yes`,
`--workspace-root`, and planner selection options.

## `dn archive` — Commit workspace with a plan-derived message

Use `dn archive` after a plan-backed task is complete and the workspace contains
the changes you want in one commit. The command reads the plan file, derives a
commit message from its title and overview, deletes the plan file, adds/removes
workspace files, and commits the result.

```bash
dn archive plans/issue-123.plan.md
```

`dn archive` reviews the current workspace state at commit time. It does not
require a staging step: in Sapling repositories it runs `sl addremove`; in Git
repositories it runs `git add -A`. Any tracked or untracked workspace changes
that are not ignored by the VCS can be included in the commit.

Use `--dry-run` to preview the derived commit message without committing or
deleting the plan file:

```bash
dn archive plans/issue-123.plan.md --dry-run
```

If the commit step fails after the plan file is removed, `dn archive` attempts
to restore the plan file before exiting with an error.

See `dn archive --help` for all options.

## `dn fixup` — Address PR feedback

Fetches a pull request's description and review comments, creates a plan to
address the feedback, and implements fixes in your local workspace.

```bash
dn fixup https://github.com/owner/repo/pull/123

# With Cursor integration
dn --agent cursor fixup https://github.com/owner/repo/pull/123

# With Claude Code
dn --agent claude fixup https://github.com/owner/repo/pull/123

# With Codex CLI
dn --agent codex fixup https://github.com/owner/repo/pull/123
```

The PR URL can also be provided via the `PR_URL` environment variable. If
already on the correct branch, no VCS commands are executed. Changes remain
uncommitted for your review.

See `dn fixup --help` for all options.

## `dn issue` — Manage GitHub issues

Provides CRUD operations for GitHub issues from the terminal. All subcommands
operate on the current repository by default (detected from the git remote).
Pass `--repo owner/repo` to target a different repository.

```bash
dn issue list                              # List open issues
dn issue list --repo owner/repo            # List issues in another repo
dn issue list --state closed --limit 10    # Closed issues, max 10
dn issue list --label bug                  # Filter by label
dn issue show 123                          # Show details and comments
dn issue show 123 --repo owner/repo        # Resolve number in another repo
dn issue show 123 --no-comments            # Details only
dn issue create --title "Bug" --body-file report.md
dn issue create --repo owner/repo --title "Bug" --body-file report.md
dn issue edit 123 --title "New title"
dn issue edit 123 --add-label bug
dn issue close 123                         # Close as completed
dn issue close 123 --reason not_planned    # Close as not planned
dn issue close 123 --comment "Fixed in #456"
dn issue reopen 123
dn issue comment 123 --body-file update.md
dn issue comment 123 --body-stdin          # Pipe body from stdin
dn issue relationship list 123
dn issue relationship add blocked-by 123 456
dn issue relationship add sub-issue 123 789
dn issue relationship reprioritize sub-issue 123 789 --after 456
dn issue relationship mark-duplicate 123 456
```

All subcommands support `--json` for machine-readable output and `--help` for
per-subcommand options. Issue references accept a number (`123`), `#123`, or a
full URL. `--repo owner/repo` sets the repository used for numeric refs and for
commands without an issue ref, such as `list` and `create`; full URLs keep using
the repository from the URL. `dn issue show` includes relationship metadata such
as parent issue, sub-issues, blockers, blocked issues, and duplicate-of when
GitHub exposes it for the issue. Those reads follow GitHub’s GraphQL paging: at
most ten related-issue references appear per blocking/sub-issue edge unless the
totals-only summary shows a larger total count (“more not shown”).
