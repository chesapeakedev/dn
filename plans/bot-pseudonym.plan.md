# Bot Pseudonym

## Overview

Give the local implementation agent a clearly separated, pseudonymous
version-control identity and make the commit ownership contract explicit. The
setup should be safe for a developer's existing identity, documented for the
user's machine, and reflected consistently in repository instructions, generated
agent skills, and kickstart's implement prompt so the implementation agent can
create its own commits with deliberate messages.

## Issue Context

- Issue: #243
- Description: Set up a configuration on the user's machine so the local agent
  uses a separate Git identity; add specific `git`/`sl` commit and
  commit-strategy instructions to `AGENTS.md`; explain what makes a good commit
  message; and update `dn` so kickstart knows the agent is responsible for its
  own commits.
- Labels: `dn`
- Relationships: No parent, sub-issues, blockers, or duplicate issue were
  provided.

## Implementation Plan

1. **Define the local identity setup.**
   - Choose a pseudonymous bot name and no-reply address that are distinct from
     the developer's normal identity.
   - Document a scoped setup for the user's machine rather than silently
     changing an existing global identity. Prefer a repository or agent-specific
     Git configuration mechanism that can be enabled for dn work and does not
     expose credentials or personal data in the repository.
   - Cover both Git and Sapling usage where the tools share Git commit metadata,
     and explain how to inspect the active identity before committing.
   - Ensure automated Git identity fallback in `sdk/github/vcs.ts` does not
     unexpectedly replace an explicitly configured bot identity. If the
     implementation adds a dn configuration field for identity, add it to the
     user-config types/parser/resolution path and keep it out of repository/CI
     configuration unless explicitly requested.

2. **Strengthen generated agent instructions.**
   - Update the `genDnSection()` content in `cli/init-agents.ts` so generated
     `AGENTS.md` guidance explains when the agent should use `sl` versus `git`,
     how to inspect status/diff, and how to create commits without staging
     assumptions that do not apply to Sapling.
   - State that the implementation agent owns the commit once implementation and
     required checks are complete, rather than telling the outer IDE harness to
     commit on its behalf. Preserve the distinction between local, PR,
     direct-publish, and `dn land` workflows where those modes genuinely differ.
   - Add concise commit-message guidance: use a short imperative/conventional
     subject, include the issue or plan context when appropriate, keep unrelated
     changes out, and use the body only to explain non-obvious rationale or
     validation.
   - Keep generated instructions idempotent and preserve unmanaged existing
     `AGENTS.md` content.

3. **Align kickstart phase prompts and workflow behavior.**
   - Update `kickstart/system.prompt.implement.md` to make the agent responsible
     for creating its own commit when the selected workflow requires a commit,
     while retaining the prohibition on committing only where the caller
     explicitly handles publication.
   - Review the orchestrator and VCS publication paths (`kickstart/lib.ts`,
     `kickstart/orchestrator.ts`, and `sdk/github/vcs.ts`) for conflicting
     automatic commits or identity setup. Define one clear owner for each
     publish mode so the agent does not create duplicate commits and the CLI
     does not overwrite the pseudonym.
   - Update any embedded-prompt loading or generated prompt artifacts needed for
     compiled dn binaries. Keep plan-file and implement-result requirements
     intact.

4. **Update checked-in documentation and generated skill goldens.**
   - Update `docs/outer-harness.md` and any user-facing command documentation to
     describe the new commit ownership contract, local identity setup, and
     expected commit-message quality.
   - Regenerate the checked-in agent skill files from `cli/init-agents.ts` using
     the repository's `make skill_goldens` workflow, rather than editing
     generated files independently.
   - Update `dn.json`/`harness_hints` only if needed to express
     repository-specific commit ownership; do not put identity secrets or
     personal email addresses in project configuration.

5. **Add focused verification.**
   - Extend `cli/test_init_agents.ts` and/or related integration tests to assert
     the generated instructions contain the VCS commands, commit strategy,
     pseudonym/identity setup guidance, and agent-owned commit rule, while
     remaining idempotent.
   - Add tests for any new configuration parsing/resolution or
     identity-selection behavior, including explicit identity precedence and the
     absence of accidental global-identity mutation.
   - Add prompt-content assertions if the implement prompt's commit contract is
     changed.
   - Run formatting, lint/type checking, and the relevant test suite; verify
     generated skill goldens are synchronized.

## Acceptance Criteria

- [ ] A documented, scoped local setup gives dn's implementation agent a
      distinct pseudonymous Git identity without overwriting the user's normal
      identity or committing secrets.
- [ ] `AGENTS.md` guidance, generated agent skills, and user-facing
      documentation explain Git/Sapling commit commands, ownership, commit
      strategy, and what constitutes a good commit message.
- [ ] Kickstart's implement workflow explicitly and consistently assigns commit
      responsibility to the intended agent without duplicate or contradictory
      commit behavior across publish modes.
- [ ] Existing explicit Git identity configuration remains authoritative, and
      any new dn identity configuration is typed, validated, correctly resolved,
      and safe for CI/repository config.
- [ ] Tests cover generated instruction content and any new
      identity/configuration behavior, with generated skill goldens kept in
      sync.
- [ ] Formatting, lint, type checking, and relevant tests pass.

## Code Pointers

### Files to Modify

- `cli/init-agents.ts` (around `genDnSection()` and generated skill assembly):
  add the canonical VCS, commit ownership, commit-message, and local identity
  instructions.
- `cli/test_init_agents.ts` and `cli/test_init_agents_integration.ts`: verify
  generated AGENTS/skill output, idempotency, and any new setup behavior.
- `kickstart/system.prompt.implement.md`: revise the implement-phase commit
  responsibility and commit-quality instructions.
- `kickstart/lib.ts` and `kickstart/orchestrator.ts` (implement/publish phase
  assembly): remove or reconcile prompt and workflow contradictions, preserving
  plan checklist and result handling.
- `sdk/github/vcs.ts` (identity and publish helpers): honor explicit identity
  configuration and ensure each publish mode has one commit owner.
- `sdk/config/types.ts`, `sdk/config/parse.ts`, and `sdk/config/resolve.ts`
  (only if identity becomes a supported dn setting): define, validate, and
  resolve user-scoped identity configuration with repository/CI safety.
- `docs/outer-harness.md`, `docs/subcommands.md`, and/or
  `docs/github-actions.md`: document the local pseudonym setup and updated
  commit contract at the relevant user-facing entry points.
- `dn.json` (only if repository-specific harness hints need updating): align
  project instructions without storing personal identity data.
- Generated `.agents/skills/dn/SKILL.md`, `.cursor/skills/dn/SKILL.md`,
  `.claude/skills/dn/SKILL.md`, and `.opencode/skills/dn/SKILL.md`
  (regenerated): keep checked-in skill goldens synchronized with the generator.

### Files to Create

- None expected. If a dedicated setup document is preferable to expanding
  existing docs, add it under `docs/` and link it from the relevant command
  documentation.

## Notes

- The issue does not specify the exact pseudonym, email address, or whether the
  identity should be configured through Git includes, environment variables, or
  a new dn user-config field. The implementation should choose a non-personal
  no-reply identity and document a reversible, scoped default; it must not
  hard-code a maintainer's personal address.
- The repository currently treats `~/.dn/config.json` as user configuration for
  agent/sandbox defaults, while `AGENTS.md` and generated skills carry
  behavioral instructions. Avoid conflating harness selection with Git author
  identity unless a concrete typed configuration design is needed.
- The current repository guidance says an outer IDE chat writes the commit after
  a local run, while the issue asks kickstart to make the agent responsible.
  This is the principal behavior conflict to resolve, and tests/docs should
  reflect the chosen ownership model consistently.
- Do not commit the plan file when landing the implementation; follow the
  repository's existing plan lifecycle.
