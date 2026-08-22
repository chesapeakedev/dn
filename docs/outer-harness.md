# Outer harness

When you chat in Cursor, Codex, Claude Code, or OpenCode with `dn` on `PATH`,
that IDE or TUI is the **outer harness**. Nested `dn --agent …` plan and
implement runs are a different role.

This page is the contract for that outer role. Update it when the kickstart UX
changes. Per-harness skill files should stay aligned with the sections below.

Install a harness skill:

```bash
dn init agents --skill --agent cursor
dn init agents --skill --agent codex
dn init agents --skill --agent claude
dn init agents --skill --agent opencode
```

Add `--scope user` to write under the home directory instead of the repo.

## Shared contract

These rules apply to every supported outer harness.

**Hybrid.** If the user names an issue, a plan file, or `kickstart` / `meld` /
`loop` / `land`, orchestrate the CLI. Do not reimplement the ticket in-chat. If
they iterate on code in this session, implement here.

**Kickstart from an issue URL.** A pasted GitHub issue URL plus "kickstart this"
should resolve argv without a flag quiz:

1. Pass the full issue URL (not a bare number).
2. If the URL's `owner/repo` is not this workspace, pass `--allow-cross-repo`
   (`-A`). Compare with `gh repo view --json nameWithOwner -q .nameWithOwner`.
   If detection fails, pass `-A` for a full URL anyway. Mention the mismatch; do
   not ask.
3. Extra guidance besides the URL → `--steer "…"`.
4. Named or attached files → `--context-file` (repeatable).
5. Leave other flags at CLI defaults unless the user asked.
6. A `/pull/` URL → `dn fixup`. A local `.md` file → kickstart that file.
7. If `plans/*.plan.md` exists and the tree is dirty, stop and ask before
   stacking another kickstart.

**Publish.** An issue URL alone is `--publish none`. Map explicit intent:

| User says                                                                       | Argv               | After success                                                                          |
| ------------------------------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------- |
| "open/create a PR", "as a PR", `--awp`, `--publish pr`                          | `--publish pr`     | Report the PR URL. Do not also commit in this chat.                                    |
| "publish direct", `--publish direct`, "push to trunk/main as part of kickstart" | `--publish direct` | Report the default branch. Do not also commit here or run `dn sync` unless they asked. |
| "publish" with no PR vs direct                                                  | Ask which          | —                                                                                      |

`--awp` is an alias for `--publish pr`. Prefer `--publish pr` in argv. Direct
commits and pushes to the default branch inside kickstart (lint only). It is not
`dn sync`.

**After a local run.** Summarize, then ask whether to commit. If yes, this chat
writes the commit with the repo VCS and omits `*.plan.md`. Do not auto-run
`dn land`. After `--publish pr` or `--publish direct`, report the PR or branch
instead.

**`dn land`.** Use for attended CLI, CI, denoise, `--issue-testplan`, RFC land,
or when the user names `dn land`. `dn sync` publishes to trunk after a local
commit.

**Nested agent.** Do not pass `--agent <this-harness>` unless asked. Let project
config or `DN_AGENT` pick the nested plan/implement harness.

**Plan mode.** Maps to `dn meld` (do not implement). After the plan is accepted,
`dn loop`, then follow the after-a-local-run rule.

Read repository `dn.json` `harness_hints` at session start.

## Support

| Harness        | `dn init agents --skill --agent` | Skill path (repo)            | Avoid nested `--agent` | Outer-harness skill           |
| -------------- | -------------------------------- | ---------------------------- | ---------------------- | ----------------------------- |
| Cursor         | `cursor`                         | `.cursor/skills/dn/SKILL.md` | `cursor`               | Supported                     |
| Codex          | `codex`                          | `.agents/skills/dn/SKILL.md` | `codex`                | Supported                     |
| Claude Code    | `claude`                         | `.claude/skills/dn/SKILL.md` | `claude`               | Supported (generated install) |
| OpenCode       | `opencode`                       | `.agents/skills/dn/SKILL.md` | `opencode`             | Supported                     |
| GitHub Copilot | —                                | —                            | —                      | Nested kickstart target only  |

User-scope paths replace the repo prefix with `~/` (`~/.cursor/skills/dn/`,
`~/.agents/skills/dn/`, `~/.claude/skills/dn/`). Codex and OpenCode generated
installs also write `agents/openai.yaml` next to `SKILL.md`.

`--agent cursor` installs the dn skill only. `base-image` and `rfc` stay under
`.agents/skills/` (`--agent opencode` or `--agent codex`).

Generated `dn` skills append an **Outer harness** section for every agent in
this table except Copilot. Hand-authored skills in this repository (Cursor,
Codex, OpenCode) should match the shared contract above.
`dn init agents
--skill` leaves unmanaged files untouched unless you pass
`--force`.

## Cursor

```bash
dn init agents --skill --agent cursor
dn init agents --skill --agent cursor --scope user
```

Writes `.cursor/skills/dn/SKILL.md` (never `~/.cursor/skills-cursor/`). This
repository keeps a short hand-authored copy at that path. Do not pass
`--agent cursor` unless asked.

Cursor as a **nested** CLI, Cloud Agent, or GitHub Actions target is documented
in [Using Cursor with Kickstart](cursor.md).

## Codex

```bash
dn init agents --skill --agent codex
dn init agents --skill --agent codex --scope user
```

Writes `.agents/skills/dn/SKILL.md` and `.agents/skills/dn/agents/openai.yaml`.
This repository keeps a short hand-authored Codex twin at that path. Do not pass
`--agent codex` unless asked.

Repo-scope Codex and OpenCode installs share `.agents/skills/dn/`. Installing
one overwrites the other if the files are managed.

## Claude Code

```bash
dn init agents --skill --agent claude
dn init agents --skill --agent claude --scope user
```

Writes `.claude/skills/dn/SKILL.md`. This repository does not check in a Claude
twin; other checkouts get the generated skill plus the Outer harness section. Do
not pass `--agent claude` unless asked.

Claude as a **nested** `claude -p` harness is documented in
[Using Claude Code with Kickstart](claude.md).

## OpenCode

```bash
dn init agents --skill --agent opencode
dn init agents --skill --agent opencode --scope user
```

Generated install writes `.agents/skills/dn/` (same tree as Codex). This
repository also keeps `.opencode/skills/dn/SKILL.md` for OpenCode's native skill
location. Do not pass `--agent opencode` unless asked.

OpenCode TUI tools (`dn_prep`, `dn_loop`, `dn_meld`, `dn_land`) are documented
in [Using dn with OpenCode](opencode.md). Outer-harness chats should still
prefer the CLI and the shared contract on this page, including ask-before-commit
instead of auto-running `dn land`.

## GitHub Copilot

`dn --agent copilot` selects Copilot as a **nested** kickstart harness. There is
no `dn init agents --skill --agent copilot` and no outer-harness skill path. Do
not treat Copilot as an outer-harness install target until a skill agent is
added.

## Related

- [`dn init agents`](subcommands.md#dn-init-agents--update-agentsmd-or-install-agent-skill)
- [Cursor nested CLI / Cloud Agents / Actions](cursor.md)
- [Claude nested CLI / Actions](claude.md)
- [OpenCode TUI tools](opencode.md)
- Skills roster: `.agents/skills/README.md`
