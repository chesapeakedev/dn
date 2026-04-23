# dn

`dn` is a tool for enhancing agentic workflows with existing popular agents.
`dn` can be also used as a subagent to interact with github & local filesystem
context. The goal of `dn` is to increase your velocity as an individual
contributor in a team setting.

`dn` intentionally lacks a conversational or session-based interface. Instead,
it focuses on plan files as high-impact, model-agnostic filesystem context.
Teams already understand markdown as part of their change management process, so
recording plans in the repo and making GitHub issues available to LLMs are easy
ways to share context between teammates and models.

## Features

- **Issue Implementation Automation** — Run `dn kickstart <issue>` to read a
  GitHub issue, build a plan, and implement changes end-to-end in one command
- **Agent Agnostic** — Works with OpenCode (default), Cursor, or Claude Code;
  switch agents with `--cursor` or `--claude` flags
- **Issue Management** — Create, view, edit, close, and comment on GitHub issues
  directly from the CLI: `dn issue create`, `dn issue show`, etc.
- **Multi-Source Merging** — Combine multiple GitHub issues and local markdown
  files into a single plan with `dn meld`
- **PR Feedback Automation** — Address review feedback automatically with
  `dn fixup <pr_url>` — fetches comments, creates a fix plan, and implements it
- **Milestone Planning** — Initialize a prioritized task stack from a GitHub
  milestone with `dn init stack <milestone>`; work through tasks in order
- **Project Insights** — Quick velocity reports and trends with `dn glance`
- **Commit Message Generation** — Derive clean commit messages from plan files
  automatically with `dn archive`
- **Instruction Context Auditing** — Inspect inherited `AGENTS.md` size and
  optional Claude token estimates with `dn context check <file>`
- **GitHub Actions Integration** — Trigger agentic workflows via the
  `denoise-build` label on any issue (`dn init build`)

## Getting Started

`dn` requires the following in your local development environment.

- [GitHub CLI (`gh`)](https://cli.github.com/) installed and authenticated (for
  Github integration)
- Git or [Sapling](https://sapling-scm.com/) installed (for managing local
  commits)

### Install by Downloading a Binary

Pre-built binaries are available on the
[GitHub Releases page](https://github.com/chesapeakedev/dn/releases/latest).
Download the binary for your platform and place it in your `PATH`.

| Platform              | Binary               |
| --------------------- | -------------------- |
| macOS (Apple Silicon) | `dn-macos-arm64`     |
| macOS (Intel)         | `dn-macos-x64`       |
| Linux (x86_64)        | `dn-linux-x64`       |
| Linux (ARM64)         | `dn-linux-arm64`     |
| Windows (x64)         | `dn-windows-x64.exe` |

```bash
# Example: install on macOS (Apple Silicon)
curl -L -o dn https://github.com/chesapeakedev/dn/releases/latest/download/dn-macos-arm64
chmod +x dn
sudo mv dn /usr/local/bin/dn
```

Replace `dn-macos-arm64` with the binary name for your platform.

On macOS, you may need to bypass Gatekeeper for the unsigned binary:

- **Right-click** the binary in Finder and select **Open**, then confirm
- **System Settings → Privacy & Security** and click **Open Anyway**
- **Terminal:** `xattr -d com.apple.quarantine $(which dn)`

Binaries compiled from source (`make install`) are not blocked by Gatekeeper.

### Install by Building from Source

[Deno](https://deno.com/) (>= 2.6.3) is required to build from source.

```bash
git clone https://github.com/chesapeakedev/dn.git
cd dn
make install
```

Run `dn --help` to see all available subcommands and options.

### GitHub authentication

Most subcommands that interact with GitHub need a token. Options:

- **GitHub CLI**: `gh auth login` (detected automatically)
- **Browser**: `dn auth` once; token is cached
- **CI/scripts**: Set `GITHUB_TOKEN` (fine-grained PAT recommended)

See [docs/authentication.md](docs/authentication.md) for details.

## Setting Up Agents

`dn` supports OpenCode (default), Cursor, Claude Code, and Codex CLI. Use the
top-level `--agent <opencode|cursor|claude|codex>` option to select an agent for
any agent-backed command. Legacy command flags such as `--cursor` and `--claude`
still work. Do not set more than one `*_ENABLED=1` environment variable at the
same time.

| Agent       | Install                                                   | Flag            |
| ----------- | --------------------------------------------------------- | --------------- |
| OpenCode    | https://opencode.dev/                                     | (default)       |
| Claude Code | https://docs.anthropic.com/en/docs/claude-code/quickstart | `--claude`      |
| Cursor      | https://cursor.com/docs/cli/installation                  | `--cursor`      |
| Codex CLI   | https://openai.com/codex/                                 | `--agent codex` |

```bash
dn --agent claude prep <issue_url>
dn --agent cursor loop --plan-file plans/issue-123.plan.md
dn --agent codex kickstart --awp <issue_url>
```

For CI or isolated Claude runs, set `CLAUDE_CODE_BARE=1` and
`ANTHROPIC_API_KEY`. Optional: add a root `CLAUDE.md` in your repo for
project-specific instructions.

See [docs/claude.md](docs/claude.md) for GitHub Actions and troubleshooting.
Plan files are agent-agnostic; `dn meld` modes apply last-mile formatting and
choose which CLI runs the plan phase.

## In-Depth Usage

Run `dn --help` for all subcommands. See
[`docs/subcommands.md`](docs/subcommands.md) for detailed docs,
[kickstart/README.md](kickstart/README.md) for kickstart, and
[`docs/api.md`](docs/api.md) for programmatic SDK usage.

### Melding Issues into a Plan

`dn meld` merges one or more sources (local markdown files and/or GitHub issue
URLs) into a single DRY document, then runs the plan phase using that content as
context. The merged markdown is not written to a file unless you pass
`--output`.

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
discussion threads.

### Markdown Plans Lifecycle

Plan files are versioned artifacts in a top-level `plans/` directory. Once a
plan is completed, `archive` derives a commit message and removes the file to
keep the repo DRY:

```bash
# Derive a commit message from the plan and remove it
dn archive plans/issue-123.plan.md --yolo
```

Without `--yolo`, `archive` prints the suggested commit message as a dry run.

### Environment Variables

| Variable               | Purpose                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------- |
| `GITHUB_TOKEN`         | GitHub authentication for CI/scripts (fine-grained PAT recommended)                    |
| `CURSOR_ENABLED`       | Set to `1` to use Cursor agent instead of OpenCode                                     |
| `CLAUDE_ENABLED`       | Set to `1` to use Claude Code instead of OpenCode (not together with `CURSOR_ENABLED`) |
| `CODEX_ENABLED`        | Set to `1` to use Codex CLI instead of OpenCode (not with other agent env toggles)     |
| `ISSUE`                | Issue URL or number; used by `kickstart` and `prep` when no positional arg is given    |
| `PLAN`                 | Plan file path; used by `loop` when `--plan-file` is not passed                        |
| `PR_URL`               | PR URL; used by `fixup` when no positional arg is given                                |
| `WORKSPACE_ROOT`       | Override the working directory for plan execution (defaults to `cwd`)                  |
| `OPENCODE_TIMEOUT_MS`  | Timeout in ms for OpenCode agent invocations (default `600000`)                        |
| `CURSOR_TIMEOUT_MS`    | Timeout in ms for Cursor agent invocations (falls back to `OPENCODE_TIMEOUT_MS`)       |
| `CLAUDE_TIMEOUT_MS`    | Timeout in ms for Claude Code invocations (falls back to `OPENCODE_TIMEOUT_MS`)        |
| `CODEX_TIMEOUT_MS`     | Timeout in ms for Codex CLI invocations (falls back to `OPENCODE_TIMEOUT_MS`)          |
| `CLAUDE_CODE_BARE`     | Set to `1` to run Claude with `--bare` (API-key / deterministic; default is off)       |
| `CLAUDE_ALLOWED_TOOLS` | Override default `--allowedTools` for Claude Code (default `Bash,Read,Edit`)           |
| `NO_COLOR`             | Disable ANSI colors/decoration ([no-color.org](https://no-color.org)); auto-set in CI  |
| `FORCE_COLOR`          | Enable colors even when stdout is not a TTY                                            |

See [docs/output-and-environment.md](docs/output-and-environment.md) for full
details on output behavior and CI detection.
