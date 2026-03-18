# AGENTS.md

This file provides instructions for agentic coding agents operating in this
repository. It documents how to work on this codebase in the same way a human
would.

## Project Overview

- Runtime: **Deno** (TypeScript-first)
- Build Output: `dn` CLI
- Entry point:
  - `cli/main.ts`: `dn` CLI
- Package management: native Deno ESM imports (`deno.json`, `jsr.json`)
- Lockfile: `deno.lock`

Agents should assume the following applications are available in the
environment. DO NOT INSTALL THESE DEPENDENCIES YOURSELF!!! THEY ARE FOR HUMANS
TO MANAGE >:(

- deno (version >=2.6.3)
- dn
- sl
- git
- cargo

dn is built from source in the repository. If you find that dn is not available,
ask users to try running `make configure`

## Reduce Blast Radius

Agents operating in this repository are expected to:

- Run lint and type checks (or reason about them) before finalizing changes.
- Respect existing architecture and domain boundaries.
- Prefer clarity and correctness over cleverness.
- Ask before large or cross-cutting architectural changes.

When in doubt, choose the simplest solution that fits existing code.

## Verifying Changes

Run `make precommit` to format the codebase, type check, and run linters. This
command should return 0 errors before you consider a task completed. `make fmt`
enforces formatting in the repo and can be run to fix up formatting quickly.

## JSR Package Quality

This repository is published on **jsr.io**. Agents should actively optimize
changes for a high JSR package score.

Guidelines aligned with https://jsr.io/docs/publishing-packages:

- Public API surface is explicit and intentional
  - Export only supported APIs from `sdk/index.ts` and other entrypoints
  - Avoid leaking internal types, helpers, or file paths
- Types are complete and accurate
  - All exported symbols must be fully typed
  - No `any`, no implicit `unknown`, no widening return types
  - Prefer precise literal unions and branded types where appropriate
- Documentation is first-class
  - Every exported function, class, and type has a TSDoc comment
  - Comments describe _behavior and guarantees_, not implementation
  - Examples are short, correct, and copy-pasteable
  - Public symbols without behavior-focused TSDoc should be treated as
    incomplete
- README and docs stay in sync
  - Public behavior changes require updating `docs/README.md`
  - New public APIs should be mentioned with a minimal example
- Stable module structure
  - Avoid breaking changes to exports without strong justification
  - Follow semantic versioning expectations when modifying public APIs
- Clean build and analysis
  - No unused exports
  - No dead code in published modules
  - Lint, type-check, and tests must pass before publishing

When making changes that affect the published surface, think like a package
consumer: discoverability, correctness, and clarity matter more than internal
convenience.

## Imports and Dependencies

- Use **Deno-style ESM imports only** (no CommonJS).
- Prefer JSR and Deno standard library over npm.
- Import aliases are defined in `deno.json` (e.g. `$std/`, `discord/`).

Guidelines:

- Prefer explicit imports over barrel files.
- Do not add new dependencies unless requested.
- Import order:
  1. Deno standard library from JSR
  2. JSR
  3. NPM

## TypeScript

- TypeScript is mandatory; `any` is NOT ALLOWED
- Use `interface` for extendable object shapes.
- Use `type` for unions and composition.
- Prefer type guards over casts.
- Avoid non-null assertions unless proven and commented.

### Naming Conventions

- Files: `camelCase.ts`
- Functions and variables: `camelCase`
- Classes and interfaces: `PascalCase`
- Constants: `SCREAMING_SNAKE_CASE` (true constants only)

Names should be:

- Descriptive
- Domain-oriented
- Free of abbreviations unless universally understood

Avoid one-letter variable names outside of very small scopes.

## Project Structure

_maintain parity with README.md_

- **`cli/`** - CLI entry point, subcommand implementations (kickstart, prep,
  loop, meld, archive)
  - `kickstart.ts` - Entry point for kickstart CLI workflows
  - `prep.ts` - Workspace and repository preparation logic
  - `loop.ts` - Iterative execution and refinement workflows
- **`docs/`** - Supplemental documentation for `dn` users & contributors & LLM's
  - `README.md` - User-facing overview and CLI usage
  - `CONTRIBUTING.md` - Contribution and workflow guidelines
  - `AGENTS.md` - Agent behavior and coding conventions
- **`glance/`** - Project velocity and reporting tools
  - `main.ts` - Glance CLI entry point
  - `collect.ts` - Data collection and aggregation
  - `render.ts` - Visualization and report generation
- **`kickstart/`** - End-to-end GitHub issue workflows
  - `lib.ts` - Public APIs for plan and loop phases
  - `orchestrator.ts` - Full workflow coordination and state transitions
  - `artifacts.ts` - Generated artifacts (plans, prompts, reports)
- **`sdk/`** - Public APIs for the dn project
  - `index.ts` - Primary SDK export surface
  - `client.ts` - Programmatic interface to dn workflows
  - `types.ts` - Shared public types and contracts

## Error Handling

- Fail fast on programmer errors.
- Gracefully handle external failures (network, I/O).

Guidelines:

- Throw `Error` objects with context.
- Never swallow errors.
- Log errors only at boundaries (CLI entrypoints, Discord handlers).

Avoid broad `catch` blocks that hide root causes.

## Async and Concurrency

- Prefer `async`/`await`.
- Always `await` unless explicitly fire-and-forget.
- Consider when `Promise.all` and other `Promise` functions can be utilized to
  improve performance

## Testing Guidelines

- Tests must be deterministic and isolated.
- Prefer testing pure logic (filters, utils, SDK pieces).
- Place tests alongside behavior when reasonable, or at repo root if global.

When adding tests:

- Use clear, descriptive test names.
- Test behavior, not implementation details.

Do not add snapshot tests unless explicitly requested.

## Using dn

Use `dn` when interacting with GitHub and local plan files. `dn` is the primary
interface to this repository's workflows. Prefer it over ad-hoc scripts or
direct API calls when preparing workspaces, iterating on plans, or coordinating
changes.

Run `dn` with no arguments to discover available subcommands. For detailed
behavior and flags, see `docs/subcommands.md`.

### Few-shot examples

These examples are illustrative prompts showing how agents should think about
using the CLI. They are not exhaustive.

```
# Discover workflows
$ dn

# Prepare a repository or workspace before making changes
$ dn prep

# Iterate on an existing plan or task until convergence
$ dn loop

# Combine or reconcile outputs from multiple iterations
$ dn meld

# Archive completed artifacts or reports
$ dn archive

# Create a new GitHub issue from a conversation
$ dn issue create --title "Brief title" --body-file description.md

# Read an issue before updating it
$ dn issue show 123

# Add a comment with updated understanding (append-only, safe default)
$ dn issue comment 123 --body-file update.md

# Replace the issue body (only when explicitly asked)
$ dn issue edit 123 --body-file revised.md
```

Guideline: if a task involves GitHub state, plans, or iteration across steps,
look for a `dn` subcommand first and structure the work around it.

### Managing GitHub issues from conversations

Agents should use `dn issue` to create, read, update, and comment on GitHub
issues directly from conversations. Users can manage their repo's issues
entirely through an agent without leaving the editor.

- **Create** new issues when you discover bugs, identify follow-up work, or the
  user asks you to file a ticket.
- **Comment** on existing issues to append refined understanding, progress
  updates, or conversation summaries. This is the safe default.
- **Edit** an existing issue's body only when the user explicitly asks to
  replace the description.
- Use `dn issue show <ref>` before editing to confirm current context.
- Use `--body-file <path>` for longer content and `--body-stdin` for short
  updates.

---

## Version Control — Sapling (`sl`), not `git`

This repo uses [Sapling](https://sapling-scm.com/) for version control. The CLI
command is `sl`, not `git`. **Never run `git` commands in this repo.** See the
[basic commands overview](https://sapling-scm.com/docs/overview/basic-commands)
for a quick reference.

### Key differences from Git

- **No staging area.** All tracked files are included when you `sl commit`. Use
  `sl add` / `sl forget` to change what is tracked.
- **Smartlog.** `sl smartlog` (or just `sl`) is the most important command — it
  replaces `git log` with a succinct view of only your relevant commits. It
  shows:
  - Important details per commit: short hash, date, author, bookmarks, title.
  - Which commits are old/landed (marked `x` with "Landed as …").
  - Your current position (`@`).
  - The graph relationship between commits.
  - The location of `main` and other remote bookmarks.
  - Your not-yet-pushed commits.

  The dashed line on the left represents `main` and elides thousands of commits
  to show just the ones relevant to you:

  ```
  $ sl
  o  5abffb8  Wednesday at 09:39  remote/main
  ╷
  ╷ @  824cbba  13 minutes ago  mary
  ╷ │  [eden] Support long paths in Windows FSCK
  ╷ │
  ╷ o  19340c0  Wednesday at 09:39  mary
  ╷ │  [eden] Close Windows file handle during Windows Fsck
  ╷ │
  ╷ o  b521925  Wednesday at 09:39  mary  #12
  ╭─╯  [eden] Use PathMap for WindowsFsck
  │
  o  2ac1861  Wednesday at 05:00  remote/stable
  ╷
  ╷ o  339f936  Jul 15 at 11:12  mary
  ╷ │  debug
  ╷ │
  ╷ x  2d4fbea [Landed as 04da3d3]  Jul 15 at 11:12  mary  #11
  ╭─╯  [sl] windows: update Python
  │
  ~
  ```

  `sl ssl` (super smartlog) fetches extra info from GitHub (PR status, CI
  checks). `sl web` opens an interactive GUI that auto-refreshes and supports
  drag-and-drop rebasing.
- **Stacks.** First-class support for editing commit stacks with `amend`,
  `fold`, `split`, and `absorb`.
- **Undo.** Most commands can be reversed with `sl undo` / `sl redo`.

### Navigation

`sl goto COMMIT` (or `sl go`) checks out a commit. The argument can be:

- A short unique-prefix hash (e.g. `b84224608`)
- A full 40-character hash
- A remote bookmark name (`main` or `remote/main`)
- A local bookmark name
- A revset expression (see below)

**Next / Prev** — move up and down a stack without remembering hashes:

```
sl prev       # check out the parent commit
sl next       # check out the child commit
sl prev 2     # move down 2 commits
sl next 3     # move up 3 commits
```

If a commit has multiple children or parents, `next`/`prev` will prompt you to
choose.

**Top / Bottom** — jump to stack endpoints:

```
sl goto top       # jump to the topmost commit in the current stack
sl goto bottom    # jump to the bottommost commit in the current stack
```

### Revsets

Revsets are a query language for specifying commits. Any command that takes a
commit argument accepts a revset expression. Common examples:

| Revset              | Meaning                                 |
| ------------------- | --------------------------------------- |
| `.`                 | Current commit (working copy parent)    |
| `.^` or `.~1`       | Parent of current commit                |
| `.~2`               | Grandparent of current commit           |
| `19340c0~-1`        | Child of `19340c0`                      |
| `draft()`           | All local (unpushed) commits            |
| `ancestors(.)`      | Current commit and all its ancestors    |
| `ancestor(., main)` | First common ancestor of `.` and `main` |
| `pr42`              | Pull request #42 (GitHub repos)         |

Run `sl help revisions` for the full language reference (operators, predicates,
and more examples).

### Common commands

| Git                           | Sapling                     |
| ----------------------------- | --------------------------- |
| `git status`                  | `sl status` / `sl st`       |
| `git diff`                    | `sl diff`                   |
| `git add FILE`                | `sl add FILE`               |
| `git commit -m "msg"`         | `sl commit -m "msg"`        |
| `git commit --amend`          | `sl amend`                  |
| `git checkout COMMIT`         | `sl goto COMMIT`            |
| `git log`                     | `sl` (smartlog)             |
| `git stash` / `git stash pop` | `sl shelve` / `sl unshelve` |
| `git rebase main`             | `sl rebase -d main`         |
| `git reset --soft HEAD^`      | `sl uncommit`               |

### Debugging & history

Unlike `git log`, `sl log` is rarely needed for day-to-day work (smartlog covers
that). It is useful for investigating deeper history:

```
sl log -l 10                   # last 10 commits in the repo
sl log file.c                  # commits that touched file.c
sl log -f file.c               # same, following renames/copies
sl log -L file.c,13:23 -p      # commits touching lines 13–23 with patches
sl log -Mp lib/                # commits touching lib/, excluding merges, with diffs
sl log -k "search term"        # commits matching a keyword (case-insensitive)
sl log -u alice                # commits by a specific user
sl log -r "a21ccf and ancestor(release_1.9)"   # check if a commit is in a release
```

Notable flags: `-p`/`--patch` (show diff), `--stat` (diffstat summary),
`-G`/`--graph` (ASCII DAG), `-T`/`--template` (custom output format),
`--removed` (include file removals).

`sl journal` (or `sl jo`) shows the history of your previously checked-out
commits — useful for finding a commit you were on earlier or recovering hidden
commits:

```
sl journal                     # history of the current checkout position
sl journal --all               # history for all bookmarks and current commit
sl journal --verbose           # include previous hash, user, timestamp
sl journal -c                  # show full commit metadata for each entry
sl journal -c --patch          # show commit metadata with diffs
```

Run `sl help COMMAND` for any command's full usage. For deeper topics:

| Help topic           | What it covers                                   |
| -------------------- | ------------------------------------------------ |
| `sl help revisions`  | Revset language: operators, predicates, examples |
| `sl help templating` | Customizing log/smartlog output with templates   |
| `sl help filesets`   | Selecting files by characteristics (`set:`)      |
| `sl help patterns`   | File name pattern syntax (glob, re:, path:)      |
| `sl help glossary`   | Definitions of common Sapling terms              |

### Workflow: `make sync`

The primary push/pull workflow is `make sync` from the repo root. It:

1. Runs lint to ensure nothing is broken
2. Rebases upstream changes under your local commits
3. Restacks orphaned draft commits if needed
4. Pushes draft commits on top of `main` to the remote

Use `make sync` when you sit down (to pull latest) and before you get up (to
push your work). It only restacks and pushes draft commits on top of `main`.

The full script (`hack/repo_sync.sh`):

```bash
#!/bin/bash
set -e

# pass lint before interacting with upstream
make lint

# rebase upstream over local
sl pull --rebase -d main

# restack only when the commit graph has orphans — draft commits whose
# parent was rewritten (amend/absorb) but whose children weren't rebased.
# "children(obsolete()) - obsolete()" finds exactly these stragglers.
needs_restack=$(sl log --rev "children(obsolete()) - obsolete()" -T "{node}\n" 2>/dev/null | head -1)
if [ -n "$needs_restack" ]; then
  sl restack
fi

# push when there are draft commits on the stack above main
# (draft() & ancestors(.) & descendants(main)). Side-branch drafts are
# ignored so they don't trigger a push.
draft_on_main=$(sl log --rev "draft() & ancestors(.) & descendants(main)" -T "{node}\n" 2>/dev/null | head -1)
if [ -n "$draft_on_main" ]; then
  sl push --to main
fi
```

If this script doesn't exist in the repo, add it & the root level `sync` make
target.

For anonymous feature branches (work not on top of `main`), use `sl` directly:

- `sl goto <rev>` to switch to the branch tip
- `sl rebase -s <tip> -d main` when ready to land
- [`sl push --to <remote-branch>`](https://sapling-scm.com/docs/commands/push)
  to share without landing

---

## Agent Expectations

- Run lint/typecheck before finalizing changes.
- Add or update tests for behavior changes.
- Keep diffs minimal. Do not introduce new tools or frameworks without
  discussion.
- Do not commit secrets or generated artifacts.
- Do not reformat unrelated files.
- When in doubt, match surrounding code style and choose the simplest solution.

---
