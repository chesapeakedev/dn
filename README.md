<p align="center">
  <img src="docs/img/denoise-logo.png" alt="Denoise logo" width="280">
</p>

# dn

`dn` is a CLI for working systematically alongside agents. It turns issues and
local specifications into durable plans, routes those plans to your preferred
agent, and helps carry work from implementation through review. We built Denoise
because coding got faster, but building software did not.

Use `dn` with OpenCode, Cursor, Claude Code, or Codex CLI. Plans live as
markdown files in your workspace, so work can move between agents and resume
across sessions without depending on a conversational interface. Use the CLI to
add github actions workflows to start transitioning your repo into a software
factory.

`dn` is one half of [Denoise](https://denoise.cloud). For in-depth documentation
on each, check out [our docs site](https://docs.denoise.cloud/introduction/)

## Features

- **Agent Assisted SDLC** — Turn a GitHub issue into working code with
  `dn kickstart`. Generate well-written commits with `dn land` and automate
  lint, rebase, and publish workflows with `dn sync`
- **GitHub integration** — Manage issues and run agentic GitHub Actions without
  leaving the CLI
- **Durable, agent-agnostic plans** — Turn one issue or several context sources
  into a durable plan with `dn meld`, then implement it with `dn loop`
- **Automated PR feedback fixes** — Fetch review comments, build a focused fix
  plan, and implement the changes with `dn fixup`
- **Prioritized development queues** — Find and organize the next valuable work
  with milestone stacks, `dn peek`, `dn todo`, and `dn tidy`
- **Context synthesis for agents** — Route issues and local documents into
  focused plans, README content, or agent instructions with `dn meld`
- **Developer device runners** — Pair a Mac or Linux machine with denoise and
  run kickstart against its warm checkouts and existing agent logins

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

Plans remain useful after the first run. Resume incomplete work with:

```bash
dn loop --plan-file plans/feature-name.plan.md
```

See the
[`dn kickstart` command reference](docs/subcommands.md#dn-kickstart--full-workflow)
for publishing modes, cross-repository work, milestone queues, and agent
selection.

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

On macOS, downloaded binaries are currently unsigned. If Gatekeeper blocks the
binary, approve it under **System Settings > Privacy & Security**, or remove the
quarantine attribute:

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

## Use this machine as a denoise runner

Pair an existing macOS or Linux development machine from **Settings > Runners**
in denoise:

```bash
dn runner connect <code> --install
cd ~/src/project
dn runner register
dn runner doctor
```

The runner accepts typed kickstart jobs over outbound HTTPS. It uses local
GitHub and agent authentication; source code, credentials, and checkout paths
stay on the machine. See the
[developer device runner guide](docs/device-runners.md) for service management,
security boundaries, and JSON commands.

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
