# Subcommands

This document describes all `dn` CLI subcommands in detail. For installation and
authentication, see the project README.

## Global flags and output

You can pass **output flags** after any subcommand to control output style:

- **`--unattended`** or **`--ci`** – Force unattended mode (no spinner, minimal
  decoration, ASCII-friendly status).
- **`--trace`** – Live-stream agent harness stdout/stderr (default in CI /
  unattended).
- **`--no-trace`** – Suppress the live agent stream (default in attended TTY).
- **`--no-color`** – Disable colors.
- **`--color`** – Enable colors even when stdout is not a TTY.

Use **`--context-file <path>`** (repeatable) to append extra files to agent
prompt context for `kickstart`, `loop`, `meld`, `fixup`, and
`land --issue-testplan`. The flag can appear before or after the subcommand:

```bash
dn --context-file notes.md --context-file src/parser.ts kickstart 123
dn kickstart --context-file notes.md 123
```

Use **`--sandbox <none|docker|exe.dev>`** to select a sandbox provider for agent
workflows (`kickstart`, `loop`, `meld`, `until`, `ensure`). Omit the value to
read `sandbox.provider` from `.github/dn/config.json`. See
[Sandbox providers](sandbox.md).

In CI, `dn` automatically sets `NO_COLOR` and runs in unattended mode. See
[Output and environment](output-and-environment.md) for NO_COLOR, FORCE_COLOR,
agent-trace defaults, and how unattended mode is detected.

Use the top-level `--version` or `-V` flag to print only the current version:

```bash
dn --version
```

## `dn completion` — Shell tab completion

Print a bash or zsh script and eval it from your shell rc:

```bash
# ~/.bashrc
eval "$(dn completion bash)"

# ~/.zshrc (after compinit)
eval "$(dn completion zsh)"
```

Completes subcommands, nested commands, and known flags (including values such
as `--agent`). Positional paths fall back to the shell's filename completion.
The completer does not call GitHub. `dn ensure` also completes recipe names from
the nearest `dn.json` when that file is readable.

## `dn ensure` — Make a named `dn.json` recipe pass

Runs a **named recipe** from project `dn.json` `ensure`. Each recipe freezes
argv (no shell) and an **intent** string so dn does not have to infer why you
ran the command. Happy path is cheap: exec the argv, stream output, exit 0. On
failure, dn captures stdout/stderr/status and runs a fixer agent with the intent
plus logs, then retries the argv until it exits 0 or the iteration bound is
reached (default 5, or `iterations` on the recipe).

This is **gate-first**, unlike
[`dn until`](#dn-until--iteration-bounded-generatorverifier-gambits) (generate
then verify). Prefer named recipes for project commands with clear intent
(`make lint`). Do not pass extra flags after the recipe name — add a separate
recipe for a different argv.

```bash
dn ensure                 # List recipes
dn ensure lint            # Exec make lint; fixer agent on failure
dn ensure tests --no-fix  # Fail-fast after one exec
```

Project configuration example:

```json
{
  "schema_version": "2.0",
  "ensure": {
    "lint": {
      "argv": ["make", "lint"],
      "intent": "Fix format, typecheck, and lint failures until make lint exits 0."
    },
    "tests": {
      "argv": ["make", "tests"],
      "intent": "Fix failing tests until make tests exits 0."
    }
  }
}
```

Recipe names match `[a-z][a-z0-9_-]*`. Kickstart and `dn loop` run the
**`lint`** recipe (fixer on) after implement so fmt/lint is fixed before land or
a PR. They do not run `ensure.tests`. Kickstart, loop, meld, and fixup prompts
include a **Delegated commands** section when recipes exist, telling outer
agents to call `dn ensure <name>` instead of the raw argv. Nested `dn ensure`
inside a fixer agent is passthrough (`DN_ENSURE_ACTIVE`) so the loop cannot
recurse. Keep `ensure.lint.argv` aligned with the lint entry of
`sync.preflight`.

`--no-fix` skips the fixer (CI or wrap-only). `--workspace-root` selects where
to search for `dn.json` (walks up from that directory).

See also `cli/ensure.ts`.

## `dn until` — Iteration-bounded generator/verifier gambits

Runs a bounded multi-tick generator/verifier workflow from a JSON config file.
One primary tick is loop-like (`dn loop` is a single implement pass on a plan);
`dn until` repeats that tick up to a shared iteration bound until a verifier
gate passes, and can schedule optional interval gambits as a fraction of that
bound. Prefer `dn until` for goal-shaped work with a shell or prompt gate — not
for issue→plan→implement (`dn meld` / `dn loop` / `kickstart`).

```bash
dn until validate .github/dn/gambit.json
dn until run .github/dn/gambit.json
dn until run .github/dn/gambit.json --once
dn until run .github/dn/gambit.json --strict-verdict
```

A config has top-level `iterations` (default `10`) and optional `timeout_ms`
(hard wall-clock abort only; default one hour). Gambit `0` is the **primary**
goal loop (every iteration). Later gambits are either:

- **Interval** — `interval` in `(0, 1]` fires `floor(iterations * interval)`
  times (capped at `iterations`). Placement: `align` (`start` | `end` |
  `spread`, default `spread`) or explicit 1-based `at` indices. Optional `phase`
  (`before` | `after`, default `before`) relative to the primary tick.
- **Tail** — `one_shot: true` runs once after the primary verifier succeeds.

Each action has exactly one of `script` or `prompt`. A generator failure stops
the run. A script verifier is done when it exits with code `0`. A prompt
verifier is done when, in order:

1. A verdict file exists (default `.dn/until-verdict.json`, or
   `verifier.verdict_path`) with `{"done": true}`, or
2. stdout contains extractable JSON with `"done": true`, or
3. `verifier.done_when.stdout_contains` matches stdout (weaker escape hatch).

Missing or unparseable prompt verdicts continue the loop unless
`--strict-verdict` is set. Prefer script verifiers when a shell gate exists.
Primary and one-shot tail verifier failures are hard; interval gambit verifier
failures are soft (log and continue). `--once` forces a single primary tick.

Use `secrets` only for environment variable names. Do not put secret values in
the JSON file. `metadata` string values are substituted into prompts as
`{{key}}` and prepended as a Context block. Set a top-level `sandbox` block to
use the same sandbox settings for every gambit.

```json
{
  "iterations": 4,
  "timeout_ms": 3600000,
  "gambits": [
    {
      "name": "raise-coverage",
      "metadata": { "goal": "Raise line coverage above 25%" },
      "generator": {
        "prompt": "Generate or extend tests for {{goal}}. Prefer small, focused tests."
      },
      "verifier": {
        "script": "deno test --coverage=cov_profile && deno coverage cov_profile --threshold=25"
      },
      "secrets": ["OPENAI_API_KEY"]
    },
    {
      "name": "review-tests",
      "interval": 0.25,
      "align": "spread",
      "generator": {
        "prompt": "Review recently added tests for gaps, flakiness, and weak assertions. Fix only clear problems."
      },
      "verifier": { "script": "make precommit" }
    }
  ]
}
```

With `iterations: 4` and `interval: 0.25`, the review gambit fires once;
`align: "spread"` places that fire on iteration `2`.

## Common argument formats

Several subcommands (`kickstart`, `meld`) accept a flexible issue or source
argument. The following formats are recognized:

- **Full GitHub issue URL**: `https://github.com/owner/repo/issues/123`
- **Issue number** (current repo): `123`
- **Local markdown file path**: `docs/spec.md` or `plans/feature.md`
- **Denoise task JSON file** (with `--denoise-task` flag or auto-detected as a
  meld/loop source): `task.json`

When a markdown file path or denoise task JSON is given, no GitHub fetch occurs
and AWP mode is not used.

## `dn runner` — Use a developer device for denoise jobs

Pairs a macOS or Linux machine with denoise and runs typed kickstart jobs
against explicitly registered checkouts.

```bash
dn runner connect <code> --install --name "Alex's MacBook Pro"
dn runner register
dn runner doctor
dn runner status --json
dn runner jobs --json
dn runner kickstart 213 --wait --json
dn runner pause
dn runner resume
dn runner rotate
dn runner start
dn runner stop
dn runner disconnect
```

`connect` opens a browser for signed-in approval and stores an expiring,
runner-scoped credential under `~/.dn/runner/` with user-only permissions.
`--install` adds a launchd or systemd user service that runs `dn runner serve`
in the background. Pairing without `--install` leaves the device offline until
you run `dn runner install` or a foreground `dn runner serve`. `dn runner start`
and `dn runner stop` load or unload that user service without revoking the
credential. `make install` and `brew upgrade` refresh an already-installed
service to the new binary; `dn runner install` is first-time setup and hung
recovery, not a step after every upgrade. Use foreground `dn runner serve` only
for diagnostics, and only after `dn runner stop` if the user service is already
running. Serve prints a timestamped timeline (ready, claim, phase, cancel,
duration, outcome) and only reprints idle status about every five minutes.

`register [path]` detects the GitHub remote and asks for an explicit trust
confirmation. Pass `--yes` only after reviewing the checkout. Repository paths
remain in the local configuration and never enter runner API payloads.

`kickstart` accepts a full GitHub issue URL or a number resolved from the
current checkout. Issue-backed device jobs may use `--publish none` or
`--publish pr`. `--publish direct` remains available only through
`--denoise-task`. `--wait` polls until the job reaches a terminal state.

Device runners also accept denoise-task jobs. Queue one from a local JSON file:

```bash
dn runner kickstart --denoise-task task.json --wait --json
```

The task document is sent inline to the runner API and the target device
materializes it into a plan-compatible markdown file.

`status`, `jobs`, `doctor`, `pause`, `resume`, `rotate`, `unregister`,
`install`, `start`, `stop`, and `disconnect` support stable JSON output.
`status` JSON includes additive `local.service` (`installed`, `running`,
`supervisor`, `path`, optional `pid`). See
[Developer device runners](device-runners.md) for setup, service paths, security
behavior, and troubleshooting.

## `dn kickstart` — Full workflow

Runs complete kickstart workflow (plan + implement phases), then
**`dn ensure
lint`** so a fixer agent can clear fmt/lint. Kickstart does not run
tests and does not push to trunk. After a leave-local run, **Land** commits and
**Sync** is the trunk gate. These verbs match the denoise task dialog; see
denoise-docs **Kickstart, land, sync, and done**. Repositories with
`strict.enabled` and `strict.require_rfcs` in `dn.json` must have a promoted RFC
corpus before kickstart runs; see [Strict mode](strict-mode.md).

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

# Docker sandbox (agent harness runs inside container; workspace bind-mounted)
dn kickstart --sandbox docker https://github.com/owner/repo/issues/123

# From a denoise task JSON file (ticketless; materialized to markdown)
dn kickstart --denoise-task task.json
dn kickstart --awp --denoise-task task.json

# Add supplemental last-minute guidance without changing the issue/context
dn kickstart --steer "Focus on validation and add regression tests" 123

# Include extra files in agent prompt context
dn kickstart --context-file notes.md --context-file src/parser.ts 123
dn --context-file notes.md kickstart 123

# Adjust plan prompt succinctness (default: medium)
dn kickstart --verbosity low 123
dn kickstart --verbosity medium 123
dn kickstart --verbosity high 123

# Skip plan generation and run implementation directly
dn kickstart --skip-plan 123
```

`--steer <prompt>` appends supplemental operator guidance as a final, clearly
labeled context section in both the plan and implement prompts. It does not
replace the issue or other workflow context.

`--context-file <path>` (repeatable) appends each file as an `Included File`
section in those same prompts, after issue context and before `--steer`. The
flag is global: `dn --context-file notes.md kickstart 123` is equivalent.

`--verbosity <low|medium|high>` is a prompt hint for the plan agent. It keeps
the existing plan structure and acceptance-criteria semantics, changing only the
requested level of explanation detail. The default is `medium`.

`dn kickstart --skip-plan <target>` skips plan-agent generation and proceeds
through the same implementation, completion, sandbox, publishing, and queue
paths as the normal kickstart workflow. For a local non-publishing run, it is
the kickstart equivalent of `dn loop <target>`.

### Cross-Repository Operations

By default, kickstart only supports implementing issues from the current
repository to ensure VCS operations work correctly. To implement issues from a
different repository, use `--allow-cross-repo` (or its short alias `-A`):

- **Allowed**: Cross-repo operations with `--publish none`, `--publish pr`, or
  `--publish direct`
- AWP applies version control and the pull request to the **current workspace**
  (execution repo). The issue URL stays on the planning repository.

Cross-repo workflows are useful when you write tickets in a private repository
but implement the functionality in a public repository. The changes are applied
to your current workspace, not the target repository.

See `dn kickstart --help` for all options.

### Continuation flow (queues and batch modes)

Kickstart can pick work from a queue when you omit an issue argument. Closing
the GitHub issue and checking off the queue item is **not** part of a normal
attended exit — use `dn land`, `--publish`, or `dn todo done` after you review.

#### Queue backends

**Todo list** (`~/.dn/todo.md`) — the default when no `--milestone` is set. The
file is a prioritized checklist of issues and plan paths managed by `dn todo`,
`dn tidy`, and `dn peek`. On start without an explicit ticket the CLI reads this
file and prompts `"Proceed with <ref>?"` for the first unchecked item. If the
list is empty the CLI offers to search the repo for open issues, score them via
the LLM, write the result, and prompt the first suggestion.

**Milestone stack** (`plans/{owner}_{repo}_{num}.stack.md`) — activated by
`--milestone <num-or-url>`. The stack file is a checklisted set of issues linked
to a GitHub milestone, generated by `dn init stack`. On start the CLI reads the
file and picks the first unchecked task. See `dn init stack --help`.

#### Attended exit (default)

After a successful plan + implement cycle with `publish: none`, kickstart exits
silently (no “mark done?” / “continue?” prompts). The orchestrator already hints
to run `dn land`. If the run came from the todo list or milestone stack, the
queue item is left unchecked until you finish review — then run `dn todo done`
(todo) or update the stack / use `--once`/`--complete` with `--publish`
(milestone).

`dn land` targets **one plan at a time**. For per-issue commit/PR without a
separate land step, use `--publish pr` or `--publish direct`.

#### Flag-controlled batch modes

| Invocation                                            | Prompt behavior                                  | Use case                                      |
| ----------------------------------------------------- | ------------------------------------------------ | --------------------------------------------- |
| `dn kickstart` (no ticket, todo has items)            | Prompt "Proceed?" before run; exit after success | Interactive single-issue from queue           |
| `dn kickstart --milestone 42`                         | Prompt "Proceed?" before run; exit after success | Interactive milestone pick                    |
| `dn kickstart --publish pr --milestone 42 --complete` | No prompts — auto-chain all remaining items      | Batch milestone completion (publish required) |
| `dn kickstart --milestone 42 --once`                  | No prompts — run exactly one item then exit      | CI / one-shot automation                      |
| `dn kickstart <url>` (explicit ticket, no queue)      | No queue interaction — run once                  | One-off issue                                 |

`--complete` and `--once` are mutually exclusive and require `--milestone`.
`--complete` also requires `--publish pr` or `--publish direct` so each stack
item is published before the next (avoids stacking multiple plans into one dirty
tree that `dn land` cannot attribute correctly).

In an attended terminal, set `EDITOR` to review the generated plan before the
implementation phase. The editor command may include arguments, such as
`EDITOR="code --wait"`. Vim and Neovim wait by default; Hunk can be used for a
read-only review with `EDITOR="hunk diff --"`. Plan review is skipped in
unattended, CI, and non-TTY runs. If `EDITOR` is unset, kickstart continues
directly to implementation.

On `--once` / `--complete` success, the stack item is marked done and the GitHub
issue is closed (same automation path as before). `--complete` then advances to
the next unchecked item until the stack is empty.

#### Land interaction

When publish mode is `none` (default, local-only) the CLI suggests `dn land`
after the run. Do not run another kickstart on top of unlanded work without
publishing — land one plan first, or use `--publish`.

#### Exit conditions

The CLI returns to the shell when any of the following are true:

- An attended run finished successfully (silent exit)
- The user answers no to "Proceed with &lt;ref&gt;?" before a no-ticket run
- `--once` was set and the single item completed
- `--complete` finished the last unchecked stack item
- A run fails (orchestrator error) — the process exits immediately

## `dn task` — Local Denoise task documents

Manages ticketless `DenoiseTaskDocument` JSON files at `~/.dn/tasks/`. Used by
Void local sync and `dn kickstart --denoise-task`. **Distinct from** `dn todo`
(`~/.dn/todo.md`), which queues GitHub issues and plan paths.

```bash
dn task list
dn task list --json
dn task show <id>
dn task upsert --file task.json
dn task upsert --stdin < task.json
dn task delete <id>
```

## `dn todo` — Prioritized task list

Manages the user-level list at `~/.dn/todo.md` (issues and plan paths,
optionally scored). This is the default no-arg `dn kickstart` queue — not the
Void document store.

```bash
# Mark first unchecked item done (and close GitHub issue if applicable)
dn todo done

# Mark a specific ref done (issue number, URL, or path)
dn todo done 42
dn todo done https://github.com/owner/repo/issues/42
dn todo done plans/auth.plan.md
```

When the ref is a GitHub issue, the issue is closed with a comment. Use this
after you’ve finished a ticket (e.g. after `dn land`, or after
`--publish direct` when you want the issue closed) to keep the list and GitHub
in sync. Attended `dn kickstart` does not mark todo items done on exit.

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

## `dn auth` — Complementary GitHub sign-in

Prefer **`gh auth login`** when you use GitHub CLI — `dn` reads `gh auth token`
automatically. Use `dn auth` only if you do not use `gh`.

```bash
dn auth              # browser device flow (Denoise GitHub App by default)
dn auth login        # same as dn auth
dn auth status       # show login + which token source won
dn auth logout       # clear dn cache only (does not affect gh)
```

Optional: set `DN_GITHUB_DEVICE_CLIENT_ID` (or `GITHUB_DEVICE_CLIENT_ID`) to use
your own GitHub App instead of Denoise. See
[`docs/authentication.md`](authentication.md).

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

Manages repository setup with `stack`, `build`, `workflows`, `agents`, and
`wizard`.

### `dn init wizard` — Guided first-run setup

Run once per machine and once per project. The wizard detects context
automatically:

- **Project mode** (inside a git or sapling checkout) writes root `dn.json`,
  projects `.github/dn/config.json`, and can optionally install workflows, RFC
  scaffolding, or a repo-scoped dn skill.
- **User mode** (outside a repository) writes personal defaults to
  `~/.dn/config.json`. Repository `dn.json` overrides those defaults when you
  work inside a checkout.

```bash
dn init wizard
dn init wizard --project --yes
dn init wizard --user
DN_YES=1 dn init wizard
```

Options:

| Flag          | Effect                                     |
| ------------- | ------------------------------------------ |
| `--project`   | Force project mode (requires VCS checkout) |
| `--user`      | Force user mode                            |
| `--yes`, `-y` | Accept defaults and skip optional prompts  |
| `--json`      | Print machine-readable summary             |

The wizard never writes secrets. After user setup, run `dn auth` if you have not
signed in to GitHub yet. After project setup, commit `dn.json` and any installed
`.github/` files.

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

The installed templates include the on-demand dispatch workflows plus scheduled
`dn.daily_kickstart`. Install/update removes the retired
`.github/workflows/dn-todo-loop.yml` when present.

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
supported agent. `--agent` is required with `--skill`. Optionally pass a skill
name after `--skill` (`dn` default, `base-image`, or `rfc`).

```bash
dn init agents --skill --agent codex
dn init agents --skill --agent claude
dn init agents --skill --agent opencode
dn init agents --skill --agent cursor
dn init agents --skill base-image --agent opencode
dn init agents --skill rfc --agent opencode
dn init agents --skill --agent codex --scope user
dn init agents --skill --agent claude --dry-run --json
```

Supported skill agents: `codex`, `claude`, `opencode`, `cursor`.

Supported skill names: `dn` (default), `base-image`, `rfc`.

Repo-scope installs write (replace `dn` with the skill name when set):

- `codex`, `opencode`: `.agents/skills/<name>/SKILL.md` and
  `.agents/skills/<name>/agents/openai.yaml`
- `claude`: `.claude/skills/<name>/SKILL.md`
- `cursor`: `.cursor/rules/<name>.mdc`

User-scope installs write:

- `codex`, `opencode`: `~/.agents/skills/<name>/SKILL.md` and
  `~/.agents/skills/<name>/agents/openai.yaml`
- `claude`: `~/.claude/skills/<name>/SKILL.md`

Cursor skill installation is repo-scoped. Managed files are idempotent; existing
unmanaged files are left untouched unless `--force` is passed. Use `--dry-run`
to inspect planned writes, skips, and conflicts without changing files.

The `base-image` skill documents golden-image hygiene and `sandbox.docker.image`
/ `sandbox.docker.dockerfile` configuration. See [sandbox.md](sandbox.md).

The `rfc` skill guides bootstrapping a durable RFC corpus with `dn rfc` for
greenfield design work. The default `dn` skill includes an RFC context section
that agents should consult before large design changes.

### `dn init stack` — Initialize stack from GitHub milestone

Creates a prioritized task list from a GitHub milestone. The command:

1. Fetches the milestone and all its open issues from GitHub
2. Scores each issue for kickstart readiness (Fibonacci: 1, 2, 3, 5, 8)
3. Creates `plans/{owner}_{repo}_{milestone-number}.stack.md` with sorted tasks
   (easiest first)
4. Opens or advances a stack artifact PR in CI (`--publish pr`) or prints manual
   commit steps

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

# Open or advance the stable stack artifact PR
dn init stack 42 --refresh --publish pr
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

# Run every remaining unchecked stack item in order (requires --publish)
dn kickstart --publish pr --milestone 42 --complete

# Run exactly one unchecked stack item for CI
dn kickstart --awp --milestone 42 --once
```

`--complete` and `--once` must be used with `--milestone` and **without** an
issue argument or `ISSUE` env var. `--complete` also requires `--publish pr` or
`--publish direct`. `--complete` runs every remaining stack item in order.
`--once` runs the first unchecked stack item, marks that one item done, and
exits. Both flags skip only the milestone queue prompts in the kickstart CLI;
plan and implement phases can still prompt internally when attended (for example
existing plan continuation or plan naming). Unattended runs auto-derive a plan
name from the issue or context title (first two words) and do not prompt; pass
`--saved-plan` to override.

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

Canonical dispatch templates (`dn.init_stack`, `dn.meld_issue_plan`,
`dn.kickstart_issue`) use `repository_dispatch` and are auto-detected from the
shipped manifest. `dn.daily_kickstart` uses schedule and `workflow_dispatch`.
Other workflows with `on.workflow_dispatch` use the same path as
`gh workflow run`.

Canonical Actions dispatches are PR-only. `dn.init_stack` opens or advances a
stack artifact PR, `dn.meld_issue_plan` updates the source issue body through
the GitHub API, and `dn.kickstart_issue` rejects `publish: none`,
`publish: direct`, and `awp: false`. The local `dn init stack` and
`dn kickstart` commands still accept explicit `none`, `pr`, and `direct`
publishing modes.

```bash
dn workflows dispatch release.yml
dn workflows dispatch triage.yml --ref my-branch
dn workflows dispatch triage.yml -f name=scully -f greeting=hello
echo '{"name":"scully"}' | dn workflows dispatch triage.yml --json
dn workflows dispatch smoke.yml --repo owner/repo

# repository_dispatch (canonical dn templates)
echo '{"schema_version":"1.0","dispatch_id":"'"$(uuidgen)"'","milestone":"1"}' \
  | dn workflows dispatch dn.init_stack --repo owner/repo --json
dn workflows dispatch dn.meld_issue_plan --repo owner/repo --json '<payload>'
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
dn glance --json
```

When the repository has an RFC corpus (`rfcs/` or `dn.json` `rfc.dir`), glance
adds a compact RFC summary strip after the velocity box: counts by status,
percent done, and RFCs updated within the window. `--json` includes an `rfc`
object with the same metrics; omit `--json` RFC fields when no corpus directory
exists.

Standalone entry (parity with CLI flags): run `glance/main.ts` with `--days`,
`--compact`, `--no-urls`, and `--json`.

See [Global flags and output](#global-flags-and-output) for `--no-color`,
`--color`, and `--unattended` / `--ci`, which affect Unicode vs ASCII and ANSI
styling (`dn` bootstraps them before glance runs).

Authentication matches other GitHub-backed commands (**`gh auth login`**,
**`dn auth`**, or **`GITHUB_TOKEN`**).

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

## `dn sync` — Git/Sapling: rebase onto trunk and publish

Trunk-landing workflow: rebase the current stack onto remote trunk and publish
that HEAD to trunk. It is **not** a pull-request workflow. Other local branches
and bookmarks are left alone. In this repository `make sync` is a thin alias
that runs the local TypeScript entrypoint.

It prefers Sapling when both VCS tools recognize the checkout (a `.sl` directory
is required so an installed `sl` does not capture plain Git repos), then falls
back to Git. **Prerequisites:** Git or Sapling (`sl`). `make` is needed only
when `sync.preflight` in `dn.json` invokes it.

**Steps (in order, fail-fast):**

1. Optional **`sync.preflight`** argv lists from `dn.json`, unless
   **`--skip-preflight`** is passed. Absent or empty `preflight` means no
   quality gate (the generic default). This repository sets `make lint` then
   `make tests`. Preflight is fail-fast and does **not** run a fixer agent.
   Kickstart already ran `dn ensure lint` (fixer) so this lint pass catches
   drift after review; tests are the additional trunk gate. `--skip-preflight`
   is a CLI escape hatch only — denoise never sends it.
2. Rebase the current work onto remote **trunk**. Trunk is `sync.trunk` when
   set; otherwise the Git remote `HEAD`; otherwise a local `main` ref. If none
   of those resolve, `dn sync` exits and asks you to set `sync.trunk`.
3. Publish the rebased local commits directly to remote trunk, or skip the push
   when no local commits remain.

Sapling uses **`sl pull --rebase -d <trunk>`**, conditionally runs
**`sl restack`** for `children(obsolete()) - obsolete()`, and publishes with
**`sl push --to <trunk>`** when `draft() & ancestors(.) & descendants(<trunk>)`
matches. Git resolves the remote tracked by local trunk (falling back to
**`origin`**), fetches trunk, rebases onto **`FETCH_HEAD`**, and publishes with
**`git push <remote> HEAD:<trunk>`**. Git does not need an equivalent restack
step. Git publishes the current HEAD to trunk even from a feature branch.

**Credentials:** `dn auth` configures the GitHub API token (`dn issue`, etc.).
Git and Sapling pushes use repository credentials (**HTTPS credential helper**,
**`gh auth`** HTTPS, or SSH) — failures usually point at remote auth, not the
OAuth cache.

From a subdirectory of the checkout:

```bash
dn sync --workspace-root /path/to/checkout
```

Project configuration example:

```json
{
  "schema_version": "2.0",
  "sync": {
    "preflight": [["make", "lint"], ["make", "tests"]],
    "trunk": "main"
  }
}
```

Troubleshooting:

- **VCS not found** — install Git or Sapling and ensure it is on PATH.
- **merge/rebase aborted** — fix conflicts reported by the VCS, then re-run
  **`dn sync`**.
- **push auth errors** — configure remote credentials (**`gh auth login`**, SSH
  remote, or a helper). Protected trunk may reject direct pushes; that is
  expected in PR-based repositories.
- **Could not determine trunk** — set `sync.trunk` in `dn.json`.
- **`make`** missing — only required when preflight argv starts with `make`. On
  this repo **`make configure`** installs `dn`; **`make sync`** runs the local
  TypeScript entrypoint via **`deno run`**.

See also [`AGENTS.md`](../AGENTS.md) (Workflow: `make sync`) and `cli/sync.ts`.

## `dn rfc` — Manage RFCs (Request for Comments) for design documents

`dn rfc` creates, lists, and manages RFCs (Request for Comments) – durable
design documents with monotonically numbered IDs, stored as Markdown files under
`rfcs/` with a Terraform-inspired `.state.json` file.

RFCs are distinct from ephemeral `plans/*.plan.md` execution plans and meant for
5–15 durable design documents that humans co-author and agents treat as
filesystem context before issue-level `meld`/`loop`/`land` workflows.

### Creating RFCs

```bash
# Initialize RFC directory and overview
dn rfc init

# Create a new RFC with automatic ID allocation
dn rfc create --title "API Design for Feature X"
dn rfc create --title "API Design for Feature X" --slug api-design
dn rfc create --title "API Design for Feature X" --github-issue https://github.com/owner/repo/issues/123
```

RFCs are created with status `draft` and get a three-digit zero-padded ID
(`001-slug.md`). The slug is auto-generated from the title if not provided.

### Listing and viewing RFCs

```bash
# List all RFCs
dn rfc list

# Filter by status
dn rfc list --status draft
dn rfc list --status accepted

# JSON output
dn rfc list --json

# Show RFC details
dn rfc show 1          # By ID
dn rfc show api-design # By slug (from filename)
dn rfc show 001-api-design.md # By path
```

### Managing RFC status

RFCs progress through a fixed lifecycle: `draft` → `review` → `accepted` →
`implementing` → `done` → `superseded`.

```bash
# Update status
dn rfc status 1 review
dn rfc status api-design accepted
dn rfc complete 1      # Shortcut for status done
```

### Configuration

The default RFC directory is `rfcs/`. Override via `dn.json`:

```json
{
  "rfc": {
    "dir": "docs/rfcs"
  }
}
```

### File structure

RFCs follow the pattern `rfcs/NNN-kebab-slug.md` where `NNN` is a zero-padded
three-digit ID allocated monotonically. The `rfcs/.state.json` file tracks:

- `nextId`: Next available RFC ID
- `rfcs`: Map of ID to metadata (path, status, content hash, optional GitHub
  issue link)

### Frontmatter

Each RFC includes YAML frontmatter:

```yaml
---
id: 1
title: "API Design for Feature X"
status: draft
github_issue: "https://github.com/owner/repo/issues/123"
---
```

### State synchronization

Frontmatter and `.state.json` stay synchronized via CLI mutations. RFCs are
never deleted by `complete` or RFC land (unlike execution-plan land, which
removes the plan file on success).

### Non-goals

Not included in this implementation:

- GitHub issue sync
- Glance metrics
- Strict-mode enforcement
- Authoring skill (follow-up)

## `dn meld` — Plan from one or more sources

`dn meld` is the plan phase of the `meld → loop → land` lifecycle. Give it one
GitHub issue, issue number, or local Markdown file for the common case. Add
sources when a useful plan needs product notes, research, or several issues.

When `strict.require_rfcs` is enabled with `strict.enabled`, meld exits before
agents run if the RFC corpus is missing or draft-only. See
[Strict mode](strict-mode.md).

```bash
# Create a plan from one issue or local specification
dn meld 123
dn meld https://github.com/owner/repo/issues/123
dn meld docs/spec.md

# Combine several sources into one plan
dn meld product-notes.md architecture.md
dn meld issue-a.md https://github.com/owner/repo/issues/123
dn meld --list sources.txt

# Name the plan or preserve the merged input
dn meld 123 --plan-name my-feature
dn meld product.md architecture.md --output plans/merged-context.md

# From a denoise task JSON file (auto-detected)
dn meld task.json

# Select an agent or plan across repositories
dn --agent claude meld 123
dn --agent codex meld 123
dn meld --allow-cross-repo https://github.com/private-org/backend-api/issues/123
```

Denoise task JSON files are auto-detected and materialized to markdown before
processing.

For multiple sources, `meld` normalizes and deduplicates the context before the
agent runs. `--output`, `-o` keeps that intermediate Markdown; it is separate
from the planner output.

Use `--target` to route the result somewhere other than the default
`plans/*.plan.md` file:

```bash
dn meld research.md ops-notes.md --target AGENTS.md
dn meld release-notes.md --target README.md
dn meld handoff.md --target github:comment:123 --yes
```

Targets include `README.md`, `AGENTS.md`, `CONTRIBUTING.md`, arbitrary Markdown
paths, `github:issue:<ref>`, and `github:comment:<ref>`. Existing document
targets use merge-style edits unless `--overwrite` is set. Use `--dry-run` to
resolve context and output paths without invoking an agent or changing GitHub.

### Milestone descriptions

Generate a user-value-focused description from all open issues in a GitHub
milestone:

```bash
dn meld --milestone 42
dn meld -m "Q2 Features"
dn meld --milestone https://github.com/owner/repo/milestone/3
```

The command writes `plans/{owner}_{repo}_{milestone}.description.md` in the
workspace.

### Fill an issue template

Fill empty sections in one GitHub issue while preserving completed sections:

```bash
dn meld --update-issue 123
dn meld --update-issue --dry-run 123
```

`--fill-template` remains an alias for `--update-issue`.

### Migrating from `prep`

`prep` has been removed. Replace `dn prep` with `dn meld`; issue numbers, issue
URLs, local Markdown files, `--milestone`, `--update-issue`, agent selection,
and plan naming are available on `meld`.

## `dn loop` — Loop phase only

Runs only the loop phase (steps 4–7: implement, completion, lint, artifacts,
validate):

```bash
dn loop plans/issue-123.plan.md
dn loop https://github.com/owner/repo/issues/123
dn loop 123

# Or via environment variable
PLAN=plans/issue-123.plan.md dn loop

# With Cursor integration
dn --agent cursor loop plans/issue-123.plan.md

# With Claude Code
dn --agent claude loop plans/issue-123.plan.md

# With Codex CLI
dn --agent codex loop plans/issue-123.plan.md

# From a denoise task JSON file (materialized to markdown)
dn loop task.json

# Add supplemental last-minute guidance without changing the plan
dn loop --steer "Keep the change minimal and test the edge cases" plans/issue-123.plan.md

# Include extra files in agent prompt context
dn loop --context-file notes.md plans/issue-123.plan.md
```

`--steer <prompt>` appends supplemental operator guidance as a final, clearly
labeled context section in the implement prompt. It does not replace the plan or
issue context, and is also included for Cursor Cloud runs.

`--context-file <path>` (repeatable) appends each file as an `Included File`
section in that prompt, after issue context and before `--steer`.

`dn loop` requires an existing plan created by `dn meld`. When you pass an issue
URL or issue number, `dn` searches `plans/` for a matching plan instead of
falling back to an unrelated local plan. Denoise task JSON files are
auto-detected, materialized to markdown, and used as the plan.

### Incomplete plans and human actions

After each implement pass, the agent updates the plan Acceptance Criteria
checkboxes and writes `.dn/implement-result.json`. `dn` prints that result so
you can decide the next step without guessing from a bare `6/8` counter.

Each unfinished task should include `work_kind`: `feature`, `tests`, `docs`, or
`other`. When every unfinished task is `work_kind: "tests"`, status is
`incomplete`, and recommendation is `rerun_loop`, attended `dn kickstart` /
`dn loop` offers a one-shot confirmation to run another implement pass focused
on tests. Unattended mode skips that prompt and never auto-runs the
continuation.

| Recommendation | Meaning                                                          | Typical next step                                                                                         |
| -------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `rerun_loop`   | Remaining work looks agent-completable                           | Run `dn loop <plan>` again (or accept the attended tests-only continuation when offered)                  |
| `edit_plan`    | Checklist is wrong or overscoped                                 | Edit `plans/*.plan.md`, then loop or land                                                                 |
| `human_action` | Operator must run a command or decide something the agent cannot | Do the printed actions (for example run tests when the repo has no single test target), then loop or land |
| `land`         | Remaining unchecked items are acceptable to leave open           | `dn land` if the delivered scope is enough                                                                |
| `blocked`      | Hard environment/codebase blocker                                | Fix the blocker before another implement pass                                                             |

Example: feature work is done, but Void only has Deno unit tests and no
`npm test` / Makefile target. The agent should leave those criteria unchecked,
set `recommendation` to `human_action`, and list the exact command under
`human_actions` instead of spinning forever on another `dn loop`.

To repeat work until a shell or prompt gate passes (with an iteration bound and
optional interval constraints), use
[`dn until`](#dn-until--iteration-bounded-generatorverifier-gambits) instead of
re-running `dn loop` by hand.

## `dn land` — Close out completed work into VCS commits

Use `dn land` after a plan-backed task is complete and the workspace contains
the changes you want to commit. **`dn land` closes out local agentic work into
durable VCS state** — it is not trunk publish (`dn sync`) and not PR creation.
After land, `dn sync` is the trunk gate (lint + tests, then rebase/push). These
verbs match the denoise task dialog; see denoise-docs **Kickstart, land, sync,
and done**.

**Execution plans** (`plans/*.plan.md`) and **RFCs** (`rfcs/*.md`) use different
land modes. Plan land uses an agent (or `--single`) to commit workspace changes
and deletes the plan file. RFC land marks the RFC `done`, refreshes
`rfcs/.state.json`, commits those files, and **never deletes** the RFC markdown.

Default mode discovers the plan file, uses an agent to draft **one**
conventional commit covering the workspace changes (splitting only for a clear
hard boundary such as production code vs dedicated tests), and deletes the plan
file on success. Prefer `dn land --single` when you want a deterministic message
with no agent. Users who want finer history can split afterward with their VCS.
**Plan land targets one plan at a time** (explicit path, `PLAN` env, or newest
`plans/*.plan.md`). For per-issue publish without a separate land step, use
`dn kickstart --publish pr|direct` instead of stacking multiple kickstarts into
one dirty workspace.

```bash
dn land
dn land plans/issue-123.plan.md
dn land rfcs/012-session-persistence.md
dn land 12                    # RFC by id when registered in rfcs/.state.json
```

RFC land accepts an RFC path, id, or slug (same refs as `dn rfc show`). It sets
status to `done`, commits the RFC markdown and `rfcs/.state.json`, and leaves
the RFC file in place. `--single` and `--issue-testplan` apply to execution
plans only.

```bash
dn land rfcs/012-session-persistence.md --dry-run
```

Use `--issue-testplan` to generate a compact `## Test Plan` checklist and upsert
it onto the **linked GitHub issue** before committing. The issue is resolved
from the plan body (full issue URL), filename (`issue-123.plan.md`), or a `#N`
citation. This is distinct from `--test-plan <path>`, which feeds an optional
local `*.test.plan.md` file into the commit agent as context only.

```bash
dn land --issue-testplan
dn land --issue-testplan plans/issue-123.plan.md
```

The generated checklist targets 5–10 bullets (capped at 12). It is not a second
implementation plan.

Use `--single` for one deterministic commit (**no agent**). It derives the
commit message from the plan and commits the whole workspace:

- **Summary:** first `#` heading, else frontmatter `name`, else `Plan`. If the
  filename looks like `<n>-….plan.md`, the summary is prefixed with `#<n>:`.
- **Body:** frontmatter `overview`, else a `## Overview` section, else the first
  ~200 characters of the plan body (whitespace collapsed). Plans with a clear H1
  and overview produce the best messages.
- Then deletes the plan file and commits (Sapling `addremove` / Git
  `git add -A`).

Use this as an escape hatch when agent land fails to return a valid commit-plan
JSON array (try another agent first with `dn --agent <name> land`).

```bash
dn land --single plans/issue-123.plan.md
```

`dn land --single` reviews the current workspace state at commit time. It does
not require a staging step: in Sapling repositories it runs `sl addremove`; in
Git repositories it runs `git add -A`.

Use `--dry-run` to preview without committing, deleting plan files, or updating
the GitHub issue. RFC land dry-run previews the status transition and commit
without writing files:

```bash
dn land plans/issue-123.plan.md --dry-run
dn land --issue-testplan --dry-run
dn land --single plans/issue-123.plan.md --dry-run
dn land rfcs/012-session-persistence.md --dry-run
```

If a commit step fails after a plan file is removed, `dn land` attempts to
restore the plan file before exiting with an error.

See `dn land --help` for all options.

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
