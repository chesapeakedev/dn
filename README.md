<p align="center">
  <img src="docs/img/denoise-logo.png" alt="Denoise logo" width="280">
</p>

# dn

`dn` is a CLI for working systematically alongside agents. It turns issues and
local specifications into durable Markdown plans, routes those plans to your
preferred agent, and carries work from implementation through review. We built
Denoise because coding got faster, but building software did not.

Use `dn` with OpenCode, Cursor, Claude Code, or Codex CLI. Plans live in your
repository, so work can move between agents and resume across sessions without
depending on a chat window.

`dn` is one half of [Denoise](https://denoise.cloud). For in-depth
documentation, see [our docs site](https://docs.denoise.cloud/introduction/).

<p align="center">
  <a href="https://asciinema.org/a/p8XBVFYPl7SQ7TJ0">
    <img src="https://asciinema.org/a/p8XBVFYPl7SQ7TJ0.svg" alt="dn kickstart demo" width="670">
  </a>
</p>

## Install

Install the latest release on macOS, Linux, or Windows:

```bash
curl -fsSL https://raw.githubusercontent.com/chesapeakedev/dn/main/scripts/install.sh | sh
```

To choose an install directory or version:

```bash
curl -fsSL https://raw.githubusercontent.com/chesapeakedev/dn/main/scripts/install.sh | sh -s -- --install-dir /usr/local/bin --version v0.1.0
```

Prebuilt binaries are also available from the
[latest GitHub release](https://github.com/chesapeakedev/dn/releases/latest):

| Platform              | Binary               |
| --------------------- | -------------------- |
| macOS (Apple Silicon) | `dn-macos-arm64`     |
| macOS (Intel)         | `dn-macos-x64`       |
| Linux (x86_64)        | `dn-linux-x64`       |
| Linux (ARM64)         | `dn-linux-arm64`     |
| Windows (x64)         | `dn-windows-x64.exe` |

macOS release binaries are signed with a Developer ID certificate and notarized.
If an older unsigned build is blocked by Gatekeeper, approve it under **System
Settings > Privacy & Security**, or remove the quarantine attribute:

```bash
xattr -d com.apple.quarantine "$(which dn)"
```

### Build from source

Building requires [Deno](https://deno.com/) 2.6.3 or later:

```bash
git clone https://github.com/chesapeakedev/dn.git
cd dn
make install
```

Run `dn --help` to explore the available workflows.

## Features

- **Issue to implementation** — Turn a GitHub issue or local spec into working
  code with `dn kickstart`, optionally opening a pull request
- **Durable, reviewable plans** — Create plans with `dn meld`, implement with
  `dn loop`, and close out commits with `dn land`
- **Goal loops until the gate passes** — Repeat generator/verifier ticks with
  `dn until` until tests, lint, or another shell gate succeeds
- **Developer device runners** — Pair a Mac or Linux machine with denoise and
  run kickstart against warm checkouts and existing agent logins
- **PR feedback to fixes** — Fetch review comments and implement a focused fix
  plan with `dn fixup`
- **Software factory automation** — Install canonical GitHub Actions and run
  overnight kickstart queues with `dn init workflows` and `dn workflows`

## Choose a path

| Need                             | Workflow                              |
| -------------------------------- | ------------------------------------- |
| Issue → plan → PR in one shot    | `dn kickstart --publish pr` / `--awp` |
| Review the plan before coding    | `dn meld` → `dn loop` → `dn land`     |
| Keep going until a gate passes   | `dn until`                            |
| Run Denoise jobs on this machine | `dn runner`                           |
| Address pull request feedback    | `dn fixup`                            |
| Overnight / CI agent runs        | `dn init workflows` + `dn workflows`  |

## Kickstart a task

`dn kickstart` is the shortest path from a task to an implementation. It asks an
agent to analyze the repository, writes a named plan under `plans/`, applies the
changes, and tracks completion in the plan's acceptance criteria.

```bash
# Implement a GitHub issue in the current workspace
dn kickstart 123

# Implement a local specification without fetching GitHub context
dn kickstart docs/spec.md

# Create a branch or bookmark, commit, push, and open a pull request
dn kickstart --awp https://github.com/owner/repo/issues/123
```

See the
[`dn kickstart` command reference](docs/subcommands.md#dn-kickstart--full-workflow)
for publishing modes, cross-repository work, milestone queues, and agent
selection.

## Plan with human checkpoints

When the work is ambiguous or needs consensus on approach, split planning and
implementation. `dn meld` writes a durable Markdown plan from an issue or local
sources; `dn loop` implements an existing plan; `dn land` closes completed work
into VCS commits.

```bash
dn meld 123
dn loop --plan-file plans/issue-123.plan.md
dn land plans/issue-123.plan.md
```

Plans remain useful after the first run. Resume incomplete work by re-running
`dn loop` on the same plan file. See
[`dn meld`](docs/subcommands.md#dn-meld--plan-from-one-or-more-sources),
[`dn loop`](docs/subcommands.md#dn-loop--loop-phase-only), and
[`dn land`](docs/subcommands.md#dn-land--close-out-completed-work-into-vcs-commits).

## Loop until the gate passes

`dn loop` is a single implement pass on a plan. Prefer `dn until` for
goal-shaped work: it repeats a generator/verifier tick until a shell or prompt
gate passes, within an iteration bound.

```bash
dn until validate .github/dn/gambit.json
dn until run .github/dn/gambit.json
```

A minimal gambit with a script verifier:

```json
{
  "iterations": 4,
  "gambits": [
    {
      "name": "raise-coverage",
      "generator": {
        "prompt": "Generate or extend tests. Prefer small, focused tests."
      },
      "verifier": {
        "script": "make precommit"
      }
    }
  ]
}
```

See the
[`dn until` command reference](docs/subcommands.md#dn-until--iteration-bounded-generatorverifier-gambits)
for interval gambits, prompt verifiers, timeouts, and sandbox settings.

## Use this machine as a denoise runner

Pair an existing macOS or Linux development machine from **Settings > Runners**
in denoise so kickstart jobs run against your warm checkouts, agent logins, and
hardware—without uploading source or credentials.

```bash
dn runner connect <code> --install
cd ~/src/project
dn runner register
dn runner doctor
```

The runner accepts typed kickstart jobs over outbound HTTPS. GitHub and agent
authentication stay local; repository paths never enter API payloads. See the
[developer device runner guide](docs/device-runners.md) for service management,
security boundaries, and JSON commands.

## Fix PR feedback

`dn fixup` gathers a pull request's description and review comments, builds a
focused remediation plan, and implements the changes in your local workspace.
Changes stay uncommitted for your review.

```bash
dn fixup https://github.com/owner/repo/pull/123
```

See the
[`dn fixup` command reference](docs/subcommands.md#dn-fixup--address-pr-feedback).

## Turn the repo into a software factory

Install canonical `dn` GitHub Actions workflows so planning and kickstart can
run in CI or on a schedule. Score a milestone into a prioritized stack, then let
daily kickstart process one ready item at a time.

```bash
dn init workflows --agent claude
dn init stack 42
# Commit .github/dn/, .github/workflows/, and the stack file
dn workflows dispatch dn.kickstart_issue --repo owner/repo --json '<payload>'
```

See
[`dn init workflows`](docs/subcommands.md#dn-init-workflows--install-canonical-workflow-templates),
[`dn init stack`](docs/subcommands.md#dn-init-stack--initialize-stack-from-github-milestone),
and [GitHub Actions](docs/github-actions.md).

## Choose an agent

OpenCode is the default. Select another supported agent globally with `--agent`:

```bash
dn --agent claude meld <issue_url>
dn --agent cursor loop --plan-file plans/issue-123.plan.md
dn --agent codex kickstart --awp <issue_url>
```

| Agent       | Value      |
| ----------- | ---------- |
| OpenCode    | `opencode` |
| Claude Code | `claude`   |
| Cursor      | `cursor`   |
| Codex CLI   | `codex`    |

Install the portable `dn` skill so an agent can discover and use these workflows
directly:

```bash
dn init agents --skill --agent codex
```

Use `--scope user` for a user-level Codex, OpenCode, or Claude installation. See
the [agent integration guides](docs/README.md#agent-integration) for setup and
troubleshooting.

## Connect GitHub

Commands that access GitHub need authentication. Use an existing GitHub CLI
session, sign in through `dn`, or provide a token in automation:

```bash
gh auth login
# or
dn auth
```

Set `GITHUB_TOKEN` for CI and other unattended environments. See
[GitHub authentication](docs/authentication.md) for token resolution,
permissions, and troubleshooting.

## Documentation

- [Command reference](docs/subcommands.md)
- [Authentication](docs/authentication.md)
- [Output, environment variables, and exit codes](docs/output-and-environment.md)
- [GitHub Actions](docs/github-actions.md)
- [Developer device runners](docs/device-runners.md)
- [Contributor guide](CONTRIBUTING.md)
