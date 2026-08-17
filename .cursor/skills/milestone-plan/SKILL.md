---
name: milestone-plan
description: >-
  Decompose a large project into a GitHub milestone and tracked issues using dn.
  Use when the user describes multi-issue work, an epic, a roadmap slice, or
  asks to create a milestone and issues from a plan in conversation.
disable-model-invocation: true
---

# Milestone planning

Turn a multi-issue project description into a reviewable milestone plan and,
only after confirmation, publish it through `dn`.

## Triggers

Use this skill when the user asks to:

- break a large project into multiple GitHub issues
- plan an epic or roadmap slice
- create a milestone from a plan
- organize related work into a prioritized issue stack

Do not use this skill for a single issue. Use the regular `dn prep` or `dn
meld`
workflow instead.

## Workflow

Follow these phases in order:

1. **Reason** — inspect the repository and the user's goals, identify scope,
   dependencies, sequencing, and non-goals. This phase is read-only: do not
   write files, create GitHub objects, or publish anything.
2. **Confirm** — present the proposed milestone title, issue list, ordering,
   dependencies, and notable assumptions. Ask the user to confirm before writing
   or publishing.
3. **Write** — after confirmation, write `plans/<slug>.milestone.json` using the
   schema in `plan-schema.md`. Issue bodies should include checkbox
   `Acceptance Criteria` sections so they are compatible with kickstart.
4. **Publish** — run `dn milestone publish plans/<slug>.milestone.json`.
   Publishing creates or updates the milestone and its tracked issues.
5. **Initialize** — after publish succeeds, run
   `dn init stack --milestone
   <milestone>` (or the exact milestone identifier
   printed by publish) to create the prioritized stack artifacts.
6. **Hand off** — report the milestone, issue URLs, generated stack path, and
   the next `dn kickstart --milestone <milestone>` command.

The `dn milestone publish` command is required for this workflow. If it is not
available yet, stop after writing the confirmed artifact and report that the
publish dependency must land first.

## Guardrails

- Never write a plan or publish GitHub changes before explicit user
  confirmation.
- Prefer `dn milestone publish`, `dn init stack`, and `dn kickstart` over direct
  `gh` commands or ad-hoc API calls.
- Do not silently retry a partial publish. Inspect the command output, report
  which milestone or issues were created, and ask whether to resume or repair.
- Preserve user-authored issue content and assumptions; do not invent dates,
  owners, or dependencies without labeling them as assumptions.
- Keep each issue independently actionable and give it measurable acceptance
  criteria.

## Artifact

Use `example.milestone.json` as a minimal model and `plan-schema.md` for the
field contract. The artifact is intentionally declarative; it does not contain
credentials or commands to call GitHub directly.

## Related

- `dn` — CLI commands and lifecycle guidance
- `publish` — dn release workflow, not milestone publishing
- `plans/` — single-issue execution plans and generated milestone artifacts
