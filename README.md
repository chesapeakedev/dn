# dn

`dn` is a CLI for delegating tasks to LLM agents using structured development
workflows. `dn` can be used as a tool or subagent by other agent harnesses like
opencode and cursor. the goal of `dn` is to increase your velocity as an
individual contributor.

`dn` is centered around plan files created, edited, and implemented
collaboratively inside the git repo. The cli can convert github issues to
markdown plan files for local implementation, as well as amend github issues
using plan file content & agent context. `dn` integrates deeply with Github,
expecting users to focus their energy writing exhaustive, well written Github
issues & plans.

`dn` intentionally lacks a conversational or "session-based" style. Memory
systems in popular frontier models are very good, but they aren't collaborative.
`dn` is focused on augmenting users in their SDLC, and modern software workflows
are extremely collaborative.

We think plan files are a high-impact strategy for model agnostic file system
context. Teams already understand how to handle markdown as part of their
current change management process (github), so having teammates record markdown
in the repo is an easy way to share context between teammates & the models they
use.

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
sometimes chainable. `dn` supports opencode (default) and Cursor agents.

### OpenCode (Default)

1. Install: https://opencode.dev/
2. Use (default mode):
   ```bash
   dn prep <issue_url>
   dn loop --plan-file plans/issue-123.plan.md
   ```

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

Plan files are largely agent-agnostic, but the `--opencode` and `--cursor` flags
apply last-mile formatting tailored to each harness.

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
terminal.

```bash
dn issue list                          # List open issues
dn issue list --state closed --limit 5 # List closed issues
dn issue show 123                      # Show issue details and comments
dn issue create --title "Bug" --body "Details"
dn issue edit 123 --title "New title"
dn issue close 123
dn issue reopen 123
dn issue comment 123 --body "Update"
```

Run `dn issue <subcommand> --help` for full options.

### Project Velocity

`dn glance` collects and renders lightweight velocity reports from GitHub
activity (issues, PRs, timelines). Useful for quick status checks and trend
analysis.

```bash
dn glance
```

See `dn glance --help` for available formats, time ranges, and filters.

### Markdown Plans Lifecycle

Plan files are first-class artifacts. By default, `dn` places them in a top
level `plans/` directory so they can be versioned, reviewed, and shared like any
other markdown. This file system context is valuable for humans & agents alike.

Common patterns:

- Commit plan files alongside code for traceability.
- Update plans as requirements change.

Popular coding assistant harnesses like Cursor & Claude Code heavily index your
file system context to provide insight without explicit prompting. Keen users
will notice that Cursor stores plan files in `~/.cursor`, not the user's repo.
If your team takes writing plan files seriously, you will quickly accrue a new
form of technical debt.

I don't know if there is a name for this debt, but it can be described as a form
of file system context rot. The value of a plan file goes away as soon as the
plan is completed in the repository. From that point forward, the file system
context is redundant because it already exists in `.git` as filesystem context.
Interestingly, old plan files also make the repo harder to understand for humans
for the same reason, so maybe there is even more than technical debt accruing.

There needs to be a way to prune plan files to ensure that the file system
context stays DRY. The `archive` subcommand helps with cleanup:

```bash
# Derive a commit message from the plan and remove it
dn archive plans/issue-123.plan.md --yolo
```

Without `--yolo`, `archive` prints the suggested commit message without making
any changes.

### Environment Variables

| Variable              | Purpose                                                                               |
| --------------------- | ------------------------------------------------------------------------------------- |
| `GITHUB_TOKEN`        | GitHub authentication for CI/scripts (fine-grained PAT recommended)                   |
| `CURSOR_ENABLED`      | Set to `1` to use Cursor agent instead of OpenCode                                    |
| `ISSUE`               | Issue URL or number; used by `kickstart` and `prep` when no positional arg is given   |
| `PLAN`                | Plan file path; used by `loop` when `--plan-file` is not passed                       |
| `PR_URL`              | PR URL; used by `fixup` when no positional arg is given                               |
| `WORKSPACE_ROOT`      | Override the working directory for plan execution (defaults to `cwd`)                 |
| `OPENCODE_TIMEOUT_MS` | Timeout in ms for OpenCode agent invocations (default `600000`)                       |
| `CURSOR_TIMEOUT_MS`   | Timeout in ms for Cursor agent invocations (falls back to `OPENCODE_TIMEOUT_MS`)      |
| `NO_COLOR`            | Disable ANSI colors/decoration ([no-color.org](https://no-color.org)); auto-set in CI |
| `FORCE_COLOR`         | Enable colors even when stdout is not a TTY                                           |

See [docs/output-and-environment.md](docs/output-and-environment.md) for full
details on output behavior and CI detection.

### Using `dn` in Github Actions

`dn` can be used in CI to automate planning, validation, or reporting steps.
Because it is a single static binary (or Deno entrypoint), setup is minimal.

Below is a complete workflow that triggers when an issue is labeled, runs
`dn kickstart` with Cursor, and posts the results back as a comment. This
pattern shows proper permissions, Deno setup, API key handling, and output
capture.

```yaml
name: Kickstart with dn

on:
  issues:
    types: [labeled]

permissions:
  contents: write
  pull-requests: write
  issues: write

jobs:
  kickstart:
    if: github.event.label.name == 'cursor awp'
    runs-on: ubuntu-latest
    outputs:
      pr_url: ${{ steps.kickstart.outputs.pr_url }}
      success: ${{ steps.kickstart.outputs.success }}
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Set up Deno
        uses: denoland/setup-deno@v1
        with:
          deno-version: ">=2.6.3"

      - name: Run dn kickstart
        id: kickstart
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          IS_OPEN_SOURCE: "true"
          NO_COLOR: "1"
        run: |
          OUTPUT=$(dn --awp --cursor "${{ github.event.issue.html_url }}" 2>&1) || EXIT_CODE=$?

          PR_URL=$(echo "$OUTPUT" | grep -oP 'PR created: \K[^\s]+' || true)

          if [ -n "$PR_URL" ]; then
            echo "pr_url=$PR_URL" >> $GITHUB_OUTPUT
            echo "success=true" >> $GITHUB_OUTPUT
          else
            echo "success=false" >> $GITHUB_OUTPUT
          fi

          exit ${EXIT_CODE:-0}

      - name: Comment results on issue
        if: always()
        uses: actions/github-script@v7
        with:
          script: |
            const prUrl = '${{ steps.kickstart.outputs.pr_url }}';
            const success = '${{ steps.kickstart.outputs.success }}' === 'true';

            const body = success
              ? `✅ Kickstart completed! PR created: ${prUrl}`
              : `❌ Kickstart failed. Check the workflow logs for details.`;

            await github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body
            });
```

Considerations for Usage in CI:

- **Authentication**: Provide `GITHUB_TOKEN` via secrets; `dn auth` is not
  suitable for CI.
- **Agent APIs**: When using agents like Cursor or OpenCode, set their API keys
  as repository secrets (e.g., `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`).
- **Permissions**: Ensure the workflow has `contents: write` for creating
  branches/commits and `pull-requests: write` for opening PRs.
- **Outputs**: Capture `dn` output to extract PR URLs and post feedback to the
  triggering issue.
