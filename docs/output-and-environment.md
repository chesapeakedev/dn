# Output and environment

This document describes how `dn` decides output style (colors, spinners,
branding) and how to control it via environment variables and global flags.

## Unattended vs attended mode

**Unattended** means non-interactive, scripted, or CI use. In unattended mode
`dn`:

- Does not show spinners; uses one-line progress (e.g.
  `[dn] Step 3: Running plan phase...` then `[dn] Step 3 done (12s).`).
- Uses minimal decoration and ASCII-friendly markers (`[OK]`, `[WARN]`,
  `[ERROR]`) instead of emoji so CI logs stay readable.
- Never blocks on interactive prompts; uses env or defaults.

**Attended** means an interactive terminal: colors, spinners, elapsed times, and
clear section headers.

Unattended mode is enabled when any of the following is true:

1. **CI** – One of these environment variables is set: `CI`, `GITHUB_ACTIONS`,
   `GITLAB_CI`, `CIRCLECI`, `TRAVIS`, `JENKINS_URL`, `BUILDKITE`,
   `TEAMCITY_VERSION`, `SYSTEM_TEAMFOUNDATIONCOLLECTIONURI` (Azure DevOps).
2. **Non-TTY** – Standard output is not a terminal (e.g. piping, or running
   inside CI where stdout is not a TTY).
3. **Explicit flag** – You pass `--unattended` or `--ci` (alias) so scripts can
   force unattended behavior even in a terminal.

In CI, `dn` also sets `NO_COLOR=1` if it is not already set, so all output is
plain text.

## Global flags

These flags can be passed after any subcommand (e.g.
`dn kickstart --unattended 123`). They are stripped before the subcommand sees
its arguments.

| Flag                     | Effect                                                                         |
| ------------------------ | ------------------------------------------------------------------------------ |
| `--unattended` or `--ci` | Force unattended mode: no spinner, minimal decoration, no interactive prompts. |
| `--no-color`             | Disable ANSI colors and decoration regardless of TTY.                          |
| `--color`                | Enable ANSI colors even when stdout is not a TTY (e.g. `dn … \| less`).        |

## Environment variables

| Variable        | Effect                                                                                                                                                    |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **NO_COLOR**    | If set (any value), disable all ANSI color/decoration. See [no-color.org](https://no-color.org). `dn` sets this automatically in CI when not already set. |
| **FORCE_COLOR** | If set, enable color even when stdout is not a TTY. See [force-color.org](https://force-color.org).                                                       |
| **TERM**        | If `TERM=dumb`, `dn` treats output as no color and no fancy sequences.                                                                                    |

## Branding

All `dn`-originated lines are prefixed with `[dn]` so that in mixed logs (e.g.
`dn` plus opencode or Cursor agent output) you can tell which lines came from
`dn`. Step and status lines use a consistent style, e.g.:

- `[dn] Step 1: Resolving issue context...`
- `[dn] [OK] Plan phase completed successfully`
- `[dn] [WARN] Linting found issues (non-blocking)`
- `[dn] [ERROR] Blocking error detected`

When delegating to opencode or Cursor agent, `dn` streams their output
unchanged; you may see a short `[dn]` progress line before or after the
delegated output.

## Exit codes

| Code | Meaning                                                               |
| ---- | --------------------------------------------------------------------- |
| `0`  | Success                                                               |
| `1`  | Failure (bad input, auth error, agent error, or unexpected exception) |

All subcommands use the same convention. When a command fails, an error message
is printed to stderr before exiting.
