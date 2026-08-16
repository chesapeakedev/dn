# Documentation

Reference documentation for `dn`. For installation and quickstart, see the
[project README](../README.md).

To print the installed version without additional output, run `dn --version`.

Kickstart and the issue CLI surface GitHub formal relationships (parent
sub-issue, blocking, duplicate-of summaries) inside generated issue markdown;
see [`docs/subcommands.md`](docs/subcommands.md) for `dn issue show` and
`dn issue relationship`. GraphQL-backed reads paginate edges (for example ten
related issues per relationship group); context files mirror GitHub totals and
include “more not shown” lines when totals exceed what was loaded.

## Guides

| Document                                            | Description                                                |
| --------------------------------------------------- | ---------------------------------------------------------- |
| [Subcommands](subcommands.md)                       | Detailed reference for every CLI subcommand                |
| [Authentication](authentication.md)                 | GitHub token setup (CLI, browser, CI)                      |
| [Output and environment](output-and-environment.md) | Colors, unattended mode, exit codes, env vars              |
| [API](api.md)                                       | Programmatic SDK usage and GitHub Actions examples         |
| [GitHub Actions](github-actions.md)                 | Running `dn` in GitHub Actions CI                          |
| [Strict mode](strict-mode.md)                       | Opt-in `dn.json` guardrails for RFC-aware planning         |
| [Denoise integration](denoise-integration.md)       | Workflow templates and dispatch contracts                  |
| [Developer device runners](device-runners.md)       | Run denoise kickstart jobs on a paired Mac or Linux device |

## Agent integration

| Document                | Description                                     |
| ----------------------- | ----------------------------------------------- |
| [OpenCode](opencode.md) | Using `dn` tools inside the OpenCode TUI        |
| [Cursor](cursor.md)     | Running kickstart with Cursor in GitHub Actions |
| [Claude](claude.md)     | Running kickstart with Claude Code CLI          |

## Infrastructure

| Document                                                       | Description                                      |
| -------------------------------------------------------------- | ------------------------------------------------ |
| [Developer device runners](device-runners.md)                  | Recommended paired-device setup for denoise      |
| [Self-hosted runners](self-hosted/self-hosted-runner-setup.md) | Advanced self-hosted GitHub Actions runner setup |

## Integrations

| Document                          | Description                                      |
| --------------------------------- | ------------------------------------------------ |
| [Denoise](denoise-integration.md) | Workflow contracts for denoise-style integrators |
