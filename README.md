# dn

`dn` is a CLI for running structured, agent-assisted development workflows. `dn`
can also be used as a tool & subagent by other agents that can use tools. `dn`
increases your throughput as an individual contributor.

## Installing

## Prerequisites

- [Deno](https://deno.com/) installed and available in PATH
- [opencode](https://opencode.dev/) optionally installed for opencode mode
- [Cursor CLI (`agent`)](https://cursor.com/docs/cli/installation) optionally
  installed for cursor mode
- [GitHub CLI (`gh`)](https://cli.github.com/) installed and authenticated (for
  Github integration)
- Git or [Sapling](https://sapling-scm.com/) installed (for managing local
  commits)

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

## Usage

Compile and install the `dn` binary with `make install`, or run directly with
Deno:

```bash
deno run --allow-all cli/main.ts <subcommand> [options]

Usage:
  dn auth
  dn issue <subcommand> [options]
  dn kickstart [options] <issue_url_or_number>
  dn prep [options] <issue_url_or_number>
  dn loop [options] --plan-file <path>
  dn fixup [options] <pr_url>
  dn meld [options] <source> [source ...]
  dn archive [options] <plan_file.plan.md>

Subcommands:
  auth         Sign in to GitHub in the browser (caches token for dn)
  issue        Manage GitHub issues (list, show, create, edit, close, reopen, comment)
  kickstart    Run full kickstart workflow (plan + implement)
  prep         Run plan phase only (creates plan file)
  loop         Run loop phase only (requires plan file from prep)
  fixup        Address PR feedback locally (fetch comments, plan, implement)
  meld         Merge and trim markdown sources (local paths and/or GitHub issue URLs)
  archive      Derive commit message from plan file; --yolo to commit and delete plan

Use 'dn <subcommand> --help' for subcommand-specific options.
```

Detailed documentation for all subcommands has moved to
[`docs/subcommands.md`](docs/subcommands.md). In general, `dn --help` should
give you enough info the navigate the CLI. The rest of this document focuses on
in-depth usage. Kickstart has its own detailed documentation, see
[kickstart/README.md](kickstart/README.md).

`dn` is centered around plan files. By convention, plan files are markdown files
with the suffix `plan.md` (e.g. `build-feature.plan.md`). Currently, we store
them in a top level directory `plans` in the user's repository.

`dn` intentionally lacks a conversational or "session-based" style. Memory
systems in popular frontier models are very good, but they aren't collaborative.
`dn` is focused on augmenting users in their SDLC, and modern software workflows
are extremely collaborative.

We think plan files are a high-impact strategy for model agnostic file system
context. Teams already understand how to handle markdown as part of their
current change management process (github), so having teammates record markdown
in the repo is an easy way to share "isomorphic" markdown - markdown content
that benefits both the teammates & the models they use.

Context other than file system is important, but early work on `dn` was focused
on plan files

## CLI Usage

### Basic Usage without Github

Without connecting to Github, the CLI can be used to manage local plan files and
make changes against the local workspace based on their content. Use this mode
when you want structured planning and execution but you're not using Github.

Typical flow:

- Collect requirements IRL or in conversation with a model
- Create a `plans/*.plan.md` file in your repo
- `dn kickstart` using a plan file via env var

Example: FIXME: is this not possible with `dn kickstart`?

```bash
# Create a plan from a local markdown file
dn prep ./notes/feature.md

# Run the implementation loop using the generated plan
# (equivalent to --plan-file)
PLAN=plans/feature.plan.md dn loop
```

In this mode, `dn` never talks to GitHub. All context comes from your working
tree and the plan file on disk.

### Basic Usage with Github

`dn` is meant to help you with your existing SDLC, which for many is Github and
its defaults. The CLI augments your local development workflow, pulling context
directly from GitHub to produce a plan file. Then, `dn` implements the plan in
your local workspace.

Typical flow:

- Start from an existing GitHub issue.
- Run `kickstart` for an end-to-end experience, or `prep` + `loop` separately.
- Commit changes and update the issue or PR as needed.

Example (all-in-one):

```bash
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
any code is written. In real world scenarios, it's beneficial to edit plan
output as a group when possible. These artifacts can be reviewed in your
existing agile ceremonies.

### Melding Issues into a Plan

It's common on large projects to create duplicate work in the team's ticket
tracking system. Software engineers working across the stack commonly pull
issues together to maximize the value created when modifying a system component.
`dn meld` is designed to enhance this workflow, pulling context from multiple
sources into a single plan file. Then, this plan file can be developed
collaboratively by multiple developers & their coding assistants.

Sources can be:

- Local markdown files
- GitHub issue URLs
- A mix of both

Example:

```bash
dn meld \
  https://github.com/org/repo/issues/101 \
  https://github.com/org/repo/issues/102 \
  docs/background.md \
  > combined.md

dn prep combined.md
```

This is especially useful for large efforts that evolve across multiple
discussion threads. The pair programming potential with this feature is very
high. What does pair programming look like with agents?

### Managing Plans in your Repo

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

### Using the CLI in Github Actions

`dn` can be used in CI to automate planning, validation, or reporting steps.
Because it is a single static binary (or Deno entrypoint), setup is minimal.

Example GitHub Actions step:

FIXME: add Cursor or ChatGPT authentication setup to the example

```yaml
- name: Run dn prep
  run: |
    deno run --allow-all cli/main.ts prep \
      https://github.com/org/repo/issues/123
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

In CI, authentication should be provided via `GITHUB_TOKEN` or a fine-grained
PAT. Interactive auth commands like `dn auth` are not suitable for CI.

## Public API Stability

`dn` exposes both a CLI and a programmatic SDK. The SDK is published on
**jsr.io** and follows explicit API stability rules:

- **Stable APIs**: Symbols exported from `@dn/sdk` top-level namespaces (for
  example `auth` and `github`) are considered stable across minor versions.
- **Behavior-focused contracts**: All public symbols are documented with TSDoc
  that describes behavior, guarantees, and error conditions rather than
  implementation details.
- **No accidental exports**: Internal helpers, low-level primitives, and
  workflow-specific utilities are intentionally not part of the public API and
  may change without notice.
- **Breaking changes**: Changes to stable APIs follow semantic versioning and
  are avoided unless strongly justified.

Consumers should rely only on documented, exported symbols and avoid deep or
internal imports, which are not supported as part of the public contract.

### Minimal SDK Usage

```ts
import { auth, github } from "@dn/sdk";

// Create a stable auth handler
const authHandler = auth.createAuthHandler(kv, {
  github: {
    clientId: "GITHUB_CLIENT_ID",
    clientSecret: "GITHUB_CLIENT_SECRET",
  },
});

// Use stable GitHub utilities
const issue = await github.fetchIssueFromUrl(
  "https://github.com/org/repo/issues/123",
);
```

### Using the Programmatic SDK in Github Actions

The SDK can be used directly when you need tighter control than the CLI
provides, such as embedding `dn` capabilities into custom automation.

Below is a complete GitHub Actions example that installs Deno, runs a small
TypeScript script using the `@dn/sdk`, and posts a useful summary derived from
an issue. This pattern works well for CI checks, reporting, or automation that
needs structured access to GitHub data.

A Github Actions script could enforce policy (for example, blocking closed or
labeled issues) by failing the job with a thrown error.

FIXME: this example is not useful because this same workflow can easily be done
with `gh` and some bash

```yaml
name: dn-sdk-example

on:
  workflow_dispatch:
    inputs:
      issue_url:
        description: "GitHub issue URL to analyze"
        required: true
        default: "https://github.com/org/repo/issues/123"

jobs:
  analyze-issue:
    runs-on: ubuntu-latest
    steps:
      - name: Check out repository
        uses: actions/checkout@v4

      - name: Install Deno
        uses: denoland/setup-deno@v1
        with:
          deno-version: v2.x

      - name: Run dn SDK script
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          deno run --allow-net --allow-env <<'EOF'
          import { github } from "@dn/sdk";

          const issueUrl = Deno.env.get("ISSUE_URL") ?? "${{ inputs.issue_url }}";

          const issue = await github.fetchIssueFromUrl(issueUrl);

          // Example: emit a short, structured summary for CI logs
          console.log("Issue summary:");
          console.log("- Title:", issue.title);
          console.log("- State:", issue.state);
          console.log("- Author:", issue.author.login);
          console.log("- Labels:", issue.labels.map(l => l.name).join(", "));
          console.log("- Comments:", issue.commentCount);

          // Fail the job if the issue is closed or labeled as blocked
          const blockedLabels = new Set(["blocked", "do-not-merge"]);
          const hasBlockedLabel = issue.labels.some(l => blockedLabels.has(l.name));

          if (issue.state === "closed" || hasBlockedLabel) {
            throw new Error("Issue is not actionable for CI automation");
          }
          EOF
```

Avoid interactive auth flows like `dn auth` in CI; always rely on environment
variables or injected secrets.
