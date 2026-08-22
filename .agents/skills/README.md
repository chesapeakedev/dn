# dn skills roster

Skills are focused instructions that extend the generic `dn` CLI guidance.
Install or copy the skill for the agent harness you use, then invoke it by its
name when its trigger matches the task.

## Skills

| Skill            | Location                         | Use when                                                                       |
| ---------------- | -------------------------------- | ------------------------------------------------------------------------------ |
| `dn`             | `.opencode/skills/dn/`           | Using dn commands, issue workflows, or repository automation                   |
| `dn` (Cursor)    | `.cursor/skills/dn/`             | Cursor IDE outer harness: kickstart / meld / loop, then ask before committing  |
| `publish`        | `.agents/skills/publish/`        | Releasing or publishing dn itself                                              |
| `milestone-plan` | `.agents/skills/milestone-plan/` | Decomposing an epic, roadmap slice, or multi-issue project into a dn milestone |

Cursor-only skills also include `denoise-docs-pr` at
`.cursor/skills/denoise-docs-pr/`. The `milestone-plan` skill is mirrored at
`.cursor/skills/milestone-plan/SKILL.md` so both supported agent locations use
the same workflow.

Install the Cursor `dn` skill in another repo with
`dn init agents --skill --agent cursor` (repo) or
`dn init agents --skill --agent cursor --scope user` (`~/.cursor/skills/dn/`).

The generic `dn` skill is the entry point for command syntax and should be
consulted alongside specialized skills.
