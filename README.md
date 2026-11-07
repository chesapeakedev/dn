<p align="center">
  <img src="docs/img/denoise-logo.png" alt="Denoise logo" width="280">
</p>

# dn

`dn` is a tool to efficiently spread work across your team and your time. It
turns GitHub issues and local specifications into durable, shareable Markdown
plans, routes those plans to your preferred agent, and carries work from
implementation through creating a pull request.

See the
[installation instructions](https://docs.denoise.cloud/dn/installation/).

## Features

- **Kickstart tasks** — Generate a plan from a GitHub issue and implement it
  with `dn kickstart` in an attendance-optional workflow
- **Streamline your flow** — Create human-reviewable plans and commits, then
  ship with `dn meld`, `dn loop`, and `dn land`
- **Build your software factory** — Use `dn runner` to self host background
  agents. Software factory is a pattern not a product!

## Kickstart a task

`dn kickstart` is a batteries-included workflow for landing work. It asks an
agent to analyze the repository for context relevant to a plan, applies the code
changes, and publishes the work.

```bash
# Implement a GitHub issue in the current workspace
dn kickstart 123

# Implement a local specification without fetching GitHub context
dn kickstart docs/spec.md

# Create a branch or bookmark, commit, push, and open a pull request
dn kickstart --publish=pr https://github.com/owner/repo/issues/123
```

In a terminal, set `EDITOR` to review the generated plan before implementation
starts. Remember VSCode needs `--wait` review compatibility.

```bash
# Review and edit with VS Code
EDITOR="code --wait" dn kickstart 123

# Review and edit with Neovim
EDITOR=nvim dn kickstart 123

# Review the plan with Hunk (read-only; edit with another editor if needed)
EDITOR="hunk diff --" dn kickstart 123
```

Plan review is skipped for unattended, CI, and non-TTY runs. The same `$EDITOR`
gate reviews agent-generated GitHub bodies from `dn meld` (`github:issue:`,
`github:comment:`, `--update-issue`) and `dn land --issue-testplan` before they
are posted.

## Set up a runner

Connect a macOS or Linux machine to denoise to run kickstart jobs on its
existing checkouts and agent login. The runner makes outbound HTTPS connections
to denoise.cloud; source code and credentials stay on the device.

1. Install `dn` and a supported agent, then open **Settings > Runners** in
   denoise and create a pairing code.
2. Run the command shown in denoise, adding `--install` to keep the runner
   available as a user service:

   ```bash
   dn runner connect <code> --install --name "My development machine"
   ```

3. Approve the device in denoise. From each workspace you want it to use, run:

   ```bash
   cd ~/src/project
   dn runner register
   dn runner doctor
   ```

Choose the paired device as the destination when you start a kickstart in
denoise. For prerequisites, troubleshooting, and runner management, see the
[developer device runner guide](docs/device-runners.md).

## Explore dn

The [dn command reference](https://docs.denoise.cloud/dn/command-reference/)
covers command options. Read the
[GitHub context guide](https://docs.denoise.cloud/dn/github-context/) for issue,
milestone, and pull request workflows, or the
[Kickstart guide](https://docs.denoise.cloud/kickstart/) to understand the core
workflow better.
