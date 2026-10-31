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

See the
[installation instructions](https://docs.denoise.cloud/dn-cli/installation/).

## Features

- **Kickstart tasks locally** — Generate a plan from a GitHub issue and
  implement it with `dn kickstart`
- **Durable, reviewable plans** — Create human-reviewable handoffs at each step
  in the SDLC with `dn meld`, `dn loop`, and `dn land`
- **Streamline PR maintenance** — Fetch review comments and implement a focused
  fix plan with `dn fixup`
- **Build your software factory** — Use `dn runner` to connect warm checkouts
  and existing agent logins to denoise, then install GitHub Actions workflows
  for dn to run in CI or on a schedule

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

In an attended terminal, set `EDITOR` to review the generated plan before
implementation starts. Remember VS Code needs `--wait` review compatibility.

```bash
# Review and edit with VS Code
EDITOR="code --wait" dn kickstart 123

# Review and edit with Neovim
EDITOR=nvim dn kickstart 123

# For compatibility & portability
EDITOR=vi dn kickstart 123
EDITOR=nano dn kickstart 123

# Review the plan with Hunk (read-only; edit with another editor if needed)
EDITOR="hunk diff --" dn kickstart 123
```

You can export your preferred editor for repeated runs:

```bash
export EDITOR=nvim
dn kickstart 123
```

Plan review is skipped for unattended, CI, and non-TTY runs. The same `$EDITOR`
gate reviews agent-generated GitHub bodies from `dn meld` (`github:issue:`,
`github:comment:`, `--update-issue`) and `dn land --issue-testplan` before they
are posted.

See the
[`dn kickstart` command reference](docs/subcommands.md#dn-kickstart--full-workflow)
for publishing modes, cross-repository work, milestone queues, and agent
selection.

## Explore dn

The [dn command reference](https://docs.denoise.cloud/dn/command-reference/)
covers every command and its options. For setup and in-depth guides, see the
[documentation site](https://docs.denoise.cloud/introduction/), including
[GitHub authentication](docs/authentication.md),
[GitHub Actions](docs/github-actions.md), and the
[contributor guide](CONTRIBUTING.md).
