---
name: dn
description: >-
  Orchestrate dn CLI issue workflows from an IDE harness. Use when the user
  mentions dn, kickstart, meld, loop, land, a GitHub issue, or a
  plans/*.plan.md file. Implement with the CLI; ask before committing.
---

# dn (Cursor)

`dn` is the primary interface for GitHub issue-driven **implementation** in this
repo. Prefer it over ad-hoc GitHub scripts or `gh` when the work is issue- or
plan-backed.

For flags and subcommand details, run `dn <subcommand> -h` or see
[docs/subcommands.md](../../../docs/subcommands.md).

## Project config (`dn.json`)

At the start of a session, read repository `dn.json` (workspace root, or walk
up). If `harness_hints` is present, apply it: a map of string keys to string
values with project-specific operator notes. Keys are freeform. Honor those
notes for this checkout. Do not put secrets in `harness_hints`.

## Hybrid

- User names an **issue**, a **plan file**, or `kickstart` / `meld` / `loop` /
  `land` → **orchestrate the CLI**. Do not reimplement the ticket in-chat.
- User iterates on code in this session (ad-hoc edits) → **implement here**.
- After implement, **ask before committing**. You write the commit if they say
  yes. Do not auto-run `dn land`.

## After implement

Default publish is local (`none`). Do not pass `--awp` / `--publish pr` unless
the user asked for a pull request. Do not stack another kickstart on uncommitted
kickstart work.

When you are the outer IDE harness (this chat):

1. Run `dn kickstart` or `dn meld` → `dn loop` to implement.
2. Summarize the plan path and what changed.
3. **Ask** whether to commit. Do not commit, and do not run `dn land`, unless
   the user says yes or already asked to commit.
4. If yes: write the commit with the repo VCS. Omit `*.plan.md` (delete it or
   leave it untracked).
5. Use `dn land` only for CLI/CI/denoise, `--issue-testplan`, RFC land, or when
   the user names `dn land`.

`dn sync` publishes to trunk. It is not a commit step.

### kickstart

The common prompt is `{github issue url} can you kickstart this?` Resolve argv.
Do not quiz the user for flags the CLI already defaults.

1. Pass the **full issue URL** as the positional argument (not a bare number).
2. Compare the URL's `owner/repo` to this workspace
   (`gh repo view --json nameWithOwner -q .nameWithOwner`). If they differ, pass
   `--allow-cross-repo` (`-A`). Do not ask. Mention it in the summary. If you
   cannot detect the workspace repo, pass `-A` for a full URL anyway.
3. Extra guidance in the user message besides the URL → `--steer "…"`.
4. Named or attached files → `--context-file` (repeatable).
5. Leave the rest at CLI defaults unless the user asked:
   - publish `none` (no `--awp` / `--publish pr`)
   - nested agent from project config / `DN_AGENT` (no `--agent cursor`)
   - no `--cursor-cloud`, `--sandbox`, `--milestone`, `--complete`, `--once`,
     `--skip-plan`, `--verbosity`, `--workspace-root`, `--denoise-task`
6. `/pull/` URL → `dn fixup`, not kickstart. Local `.md` → kickstart that file.
7. If `plans/*.plan.md` exists and the tree is dirty, stop and ask before
   stacking another kickstart.

```bash
dn kickstart https://github.com/owner/repo/issues/123
dn kickstart --allow-cross-repo https://github.com/other/repo/issues/123
dn kickstart --steer "Focus on the parser" https://github.com/owner/repo/issues/123
# then ask: commit now?
```

### meld → loop

```bash
dn meld 123
dn loop plans/issue-123.plan.md
# then ask: commit now?
```

## Cursor notes

- Kickstart is a **CLI command**, not a Cursor Task/subagent.
- Do **not** pass `--agent cursor` unless asked (avoids Cursor-in-Cursor). Let
  project config or `DN_AGENT` pick the nested harness.
- Plan mode maps to `dn meld` (do not implement). After the plan is accepted,
  `dn loop`, then ask before committing.

## Issues

```bash
dn issue show 123
dn issue comment 123 --body-file update.md
dn issue create --title "Brief title" --body-file description.md
```

Comment is the safe default. Edit the issue body only when the user explicitly
asks to replace it. Use `--repo owner/repo` for another repository.

## Related

- Specialized skills: `.agents/skills/README.md` (`milestone-plan`, `rfc`,
  `publish`)
- Nested Cursor CLI / Cloud Agents: [docs/cursor.md](../../../docs/cursor.md)
