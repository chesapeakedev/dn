# dn

`dn` is a CLI for delegating tasks to LLM agents using structured development
workflows. `dn` can be used as a tool or subagent by other agent harnesses like
opencode and cursor. the goal of `dn` is to increase your velocity as an
individual contributor in a team setting.

`dn` is centered around plan files.`dn` integrates deeply with Github, expecting
users to focus their energy writing exhaustive, well written Github issues &
plans. Pairing `dn` with an agent creates a conversational interface for this
work

`dn` itself intentionally lacks a conversational or "session-based" interface.
Memory systems and other context sources in popular frontier models are very
good, but they aren't collaborative. `dn` is focused on augmenting users in
their software development process, and modern software workflows are extremely
collaborative.

We think plan files are a high-impact strategy for model agnostic file system
context that are easy to adopt. Teams already understand how to handle markdown
as part of their current change management process (github), so recording
markdown in the repo & making github issues available to the LLM are easy ways
to share context between teammates & the models they use.

## Quickstart

```bash
git clone https://github.com/chesapeake/dn.git && cd dn && make install
dn kickstart https://github.com/org/repo/issues/123
```

## Getting Started

`dn` requires the following in your local development environment.

- [Deno](https://deno.com/) (>= 2.6.3) to run `dn` as a script or compile it for
  local installation
- [GitHub CLI (`gh`)](https://cli.github.com/) installed and authenticated (for
  Github integration)
- Git or [Sapling](https://sapling-scm.com/) installed (for managing local
  commits)

Install `dn` from the source repository:

```bash
git clone https://github.com/chesapeake/dn.git
cd dn
make install
```

Run `dn --help` to see all available subcommands and options.

### GitHub authentication

Most subcommands that interact with GitHub (`kickstart`, `prep`, `glance`) need
a GitHub token. Preferred options are:

- **GitHub CLI**: Install [GitHub CLI](https://cli.github.com/) and run
  `gh auth login`; no token or env var needed.
- **Browser**: Run `dn auth` once; sign in in the browser; the token is cached
  for future runs.

For CI and scripts, set `GITHUB_TOKEN` with a Personal Access Token
(fine-grained PAT recommended). See
[docs/authentication.md](docs/authentication.md) for details.

## Setting Up Agents

`dn` invokes an agent to perform work, performing predefined workflows,
sometimes chainable. `dn` supports OpenCode (default), Cursor, and Claude Code.

### OpenCode (Default)

1. Install: https://opencode.dev/
2. Use (default mode):
   ```bash
   dn prep <issue_url>
   dn loop --plan-file plans/issue-123.plan.md
   ```

### Claude Code

1. Install: https://docs.anthropic.com/en/docs/claude-code/quickstart
2. Local `dn` runs use your normal Claude Code login (same idea as Cursor’s
   CLI). For CI or isolated runs, set `CLAUDE_CODE_BARE=1` and
   `ANTHROPIC_API_KEY`.
3. Enable Claude mode:

   ```bash
   dn prep --claude <issue_url>
   dn loop --claude --plan-file plans/issue-123.plan.md
   dn kickstart --awp --claude <issue_url>

   # Or environment variable (do not set both with CURSOR_ENABLED)
   export CLAUDE_ENABLED=1
   dn prep <issue_url>
   ```

Optional: add a root `CLAUDE.md` in your repo for project-specific instructions
Claude Code should follow.

See [docs/claude.md](docs/claude.md) for GitHub Actions and troubleshooting.

### Cursor CLI

1. Install: https://cursor.com/docs/cli/installation
2. Authenticate: `agent auth`
3. Enable Cursor mode:
   ```bash
   # Per command
   dn prep --cursor <issue_url>
   dn loop --cursor --plan-file plans/issue-123.plan.md

   # Or environment variable
   export CURSOR_ENABLED=1
   dn prep <issue_url>
   dn loop --plan-file plans/issue-123.plan.md
   ```

Plan files are largely agent-agnostic, but `dn meld` modes (`--opencode`,
`--cursor`, `--claude`) apply last-mile formatting and choose which CLI runs the
plan phase.

## Detailed Usage

Detailed documentation for all subcommands can be found at
[`docs/subcommands.md`](docs/subcommands.md). In general, `dn --help` should
give you enough info the navigate the CLI. The rest of this document focuses on
in-depth usage. Kickstart has its own detailed documentation, see
[kickstart/README.md](kickstart/README.md). For programmatic usage and
integration details, see [`docs/api.md`](docs/api.md).

### Basic CLI Usage without Github

Without connecting to Github, the CLI can be used to manage local plan files and
make changes against your local workspace based on their content. Use this mode
when you want structured planning and execution as filesystem context but you're
not using Github.

Typical flow:

- Collect requirements with your existing process
- Create a `plans/*.plan.md` file in your repo
- `dn loop` using a plan file via environment variable

```bash
# Create a plan from a local markdown file
dn prep ./plans/feature.md

# Run the implementation loop using the generated plan
PLAN=plans/feature.plan.md dn loop
```

### Basic Usage with Github

`dn` is meant to help you with your existing SDLC, which for many is Github and
its defaults. The CLI augments your local development workflow, pulling context
directly from GitHub to produce a plan file. Then, `dn` implements the plan in
your local workspace.

Typical flow:

- Start from an existing GitHub issue
- Run `kickstart` for an end-to-end experience, or `prep` + `loop` separately
- Create a pull request adhering to your team's existing flow

Example (all-in-one):

```bash
# read repo issues 123 content and build a local plan file from it. Then,
# execute the plan against your local repo
dn kickstart https://github.com/org/repo/issues/123
```

Example (explicit phases):

```bash
# Generate a plan from the issue
dn prep https://github.com/org/repo/issues/123

# Review/edit the plan file
$EDITOR plans/issue-123.plan.md

# Execute the plan
dn loop --plan-file plans/issue-123.plan.md
```

Using explicit phases makes the planning artifact visible and reviewable before
any code is written. For larger tasks, it's beneficial to edit plan output as a
group when possible. These artifacts can be reviewed in your existing agile
ceremonies.

See [`docs/github.md`](docs/github.md) for GitHub Actions CI integration
examples.

### Melding Issues into a Plan

It's common on large projects to create duplicate work in the team's ticket
tracking system. Software engineers working across the stack commonly pull
issues together to maximize the value created when modifying a system component.
`dn meld` merges one or more sources into a single DRY document and then runs
the plan phase (prep) using that content as context, producing a plan file. The
merged markdown is not written to a file unless you pass `--output`.

Sources can be:

- Local markdown files
- GitHub issue URLs
- A mix of both (one or more)

Example:

```bash
# Merge issues and a local doc; plan phase runs at the end and prints the plan path
dn meld \
  https://github.com/org/repo/issues/101 \
  https://github.com/org/repo/issues/102 \
  docs/background.md

# Optionally write merged markdown to a file and set plan name
dn meld -o plans/combined.md --plan-name combined \
  https://github.com/org/repo/issues/101 \
  docs/background.md
```

This is especially useful for large efforts that evolve across multiple
discussion threads. The pair programming potential with this feature is very
high. What does pair programming look like with agents?

### Fixing Up a PR

`dn fixup` addresses pull request feedback locally. Given a PR URL, it fetches
the description and all review comments, creates a plan to address the feedback,
and implements fixes in your workspace.

```bash
# Address PR feedback
dn fixup https://github.com/org/repo/pull/456
```

### Managing Issues

`dn issue` provides CRUD operations for GitHub issues without leaving the
terminal. Combined with an agent, users can create and update issues entirely
from conversation -- no context switching to a browser.

```bash
dn issue list                          # List open issues
dn issue list --state closed --limit 5 # List closed issues
dn issue show 123                      # Show issue details and comments
dn issue create --title "Bug" --body-file report.md
dn issue edit 123 --title "New title"
dn issue edit 123 --body-file revised.md
dn issue close 123
dn issue reopen 123
dn issue comment 123 --body-file update.md
```

Run `dn issue <subcommand> --help` for full options.

#### Creating and updating issues from agent conversations

Agents can manage GitHub issues on your behalf during a conversation. Common
patterns:

- **"File an issue for that bug we found"** -- the agent writes structured
  Markdown and runs `dn issue create --title "..." --body-file <path>`.
- **"Update the ticket with what we learned"** -- the agent summarizes the
  conversation and runs `dn issue comment <ref> --body-file <path>` to append an
  update, or `dn issue edit <ref> --body-file <path>` if you explicitly want to
  replace the issue body.

The convention is to default to `comment` (append-only) over `edit` (replaces
body) unless you specifically ask to rewrite the description. Both commands
accept `--body-stdin` for short content and `--body-file <path>` for longer
updates. Agents are encouraged to use `dn issue show <ref>` before editing to
confirm the current state of the issue.

### Markdown Plans Lifecycle

Plan files are first-class artifacts. By default, `dn` places them in a top
level `plans/` directory so they can be versioned, reviewed, and shared like any
other file.

Over time, you'll accrue plan files in the repository. The value of a plan file
goes away as soon as the plan is completed in the repository, so these files
become wasted space in the repo slowing down git operations. From that point
forward, the file system context is redundant because it already exists in
`.git` as filesystem context.

The `archive` subcommand prunes plan files to ensure the file system context
stays DRY:

```bash
# Derive a commit message from the plan and remove it
dn archive plans/issue-123.plan.md --yolo
```

Without `--yolo`, `archive` prints the suggested commit message without making
any changes, sort of like a dry run.

### Environment Variables

| Variable               | Purpose                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------- |
| `GITHUB_TOKEN`         | GitHub authentication for CI/scripts (fine-grained PAT recommended)                    |
| `CURSOR_ENABLED`       | Set to `1` to use Cursor agent instead of OpenCode                                     |
| `CLAUDE_ENABLED`       | Set to `1` to use Claude Code instead of OpenCode (not together with `CURSOR_ENABLED`) |
| `ISSUE`                | Issue URL or number; used by `kickstart` and `prep` when no positional arg is given    |
| `PLAN`                 | Plan file path; used by `loop` when `--plan-file` is not passed                        |
| `PR_URL`               | PR URL; used by `fixup` when no positional arg is given                                |
| `WORKSPACE_ROOT`       | Override the working directory for plan execution (defaults to `cwd`)                  |
| `OPENCODE_TIMEOUT_MS`  | Timeout in ms for OpenCode agent invocations (default `600000`)                        |
| `CURSOR_TIMEOUT_MS`    | Timeout in ms for Cursor agent invocations (falls back to `OPENCODE_TIMEOUT_MS`)       |
| `CLAUDE_TIMEOUT_MS`    | Timeout in ms for Claude Code invocations (falls back to `OPENCODE_TIMEOUT_MS`)        |
| `CLAUDE_CODE_BARE`     | Set to `1` to run Claude with `--bare` (API-key / deterministic; default is off)       |
| `CLAUDE_ALLOWED_TOOLS` | Override default `--allowedTools` for Claude Code (default `Bash,Read,Edit`)           |
| `NO_COLOR`             | Disable ANSI colors/decoration ([no-color.org](https://no-color.org)); auto-set in CI  |
| `FORCE_COLOR`          | Enable colors even when stdout is not a TTY                                            |

See [docs/output-and-environment.md](docs/output-and-environment.md) for full
details on output behavior and CI detection.
