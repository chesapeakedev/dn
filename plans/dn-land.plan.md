---
name: dn land
overview: "Add `dn land` as the post-implementation commit phase. Replace `dn archive` entirely; today's archive behavior becomes `dn land --single`."
todos: []
isProject: false
---

# dn land

GitHub issue: [#341](https://github.com/chesapeakedev/chesapeake/issues/341)

## Decision

**Replace `dn archive` with `dn land`.** There are no external users yet, so no
deprecation alias or migration period.

| Today                                      | After                                                 |
| ------------------------------------------ | ----------------------------------------------------- |
| `dn archive plans/foo.plan.md`             | `dn land --single plans/foo.plan.md`                  |
| `dn archive plans/foo.plan.md --dry-run`   | `dn land --single plans/foo.plan.md --dry-run`        |
| (default multi-commit path does not exist) | `dn land` — agent-driven, one or more logical commits |

`--single` preserves current archive semantics: deterministic message from plan
via [`deriveCommitMessage`](../sdk/archive/derive.ts), one commit via
[`commitWorkspace`](../sdk/archive/commit.ts), delete plan file on success.

Default `dn land` (no `--single`) is the new agent-driven path: auto-discover
plan (+ optional test plan), group changes into logical commits,
conventional-commit messages anchored in plan context.

## Context

- [`cli/archive.ts`](../cli/archive.ts) and [`sdk/archive/`](../sdk/archive/)
  implement deterministic single-commit landing today.
- Default kickstart leaves a dirty workspace and keeps the plan file
  ([`kickstart/orchestrator.ts`](../kickstart/orchestrator.ts)).
- AWP mode commits with a blunt `#N title` message — land can improve that in a
  follow-up.
- Documented workflow today is `prep → loop → meld → archive`; becomes
  `prep → loop → meld → land`.

## CLI surface

### `dn land` (default)

Post-implementation phase for a dirty workspace.

**Behavior:**

1. Discover plan file (explicit path arg, or heuristics: newest
   `plans/*.plan.md`, `PLAN` env, kickstart output path)
2. Optionally discover test plan file (e.g. `*.test.plan.md` sibling or
   `--test-plan`)
3. Analyze workspace diff + plan context
4. Agent proposes one or more logical commits (grouped files,
   conventional-commit messages referencing plan intent)
5. Apply commits via VCS (`sl` / `git`); delete plan file(s) on success
6. `--dry-run` previews proposed commits without writing

**Flags (initial):**

- `--single` — skip agent; use archive behavior (see below)
- `--dry-run` — preview only
- `--test-plan <path>` — optional test plan
- `--workspace-root <path>`
- Agent harness flags (same as other dn commands)

### `dn land --single`

Deterministic replacement for `dn archive`. No agent invocation.

**Behavior:**

1. Require or accept plan file path (same as archive today)
2. `deriveCommitMessage(planContent, planFilePath)`
3. Print message; unless `--dry-run`, delete plan file and
   `commitWorkspace(message)`
4. Restore plan file if commit fails (same as archive today)

## Implementation layout

| Area                                                              | Action                                                                                                                                                     |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`cli/land.ts`](../cli/land.ts)                                   | New handler: `--single` branch delegates to archive logic; default branch runs agent land phase                                                            |
| [`cli/archive.ts`](../cli/archive.ts)                             | **Delete** — logic moves into `cli/land.ts` or shared helper                                                                                               |
| [`cli/main.ts`](../cli/main.ts)                                   | Replace `archive` case with `land`; update usage text                                                                                                      |
| [`sdk/archive/`](../sdk/archive/)                                 | **Keep** — rename module to `sdk/land/` optional; at minimum keep `deriveCommitMessage`, `commitWorkspace`, `commitStaged` and re-export from `sdk/mod.ts` |
| [`cli/test_archive.ts`](../cli/test_archive.ts)                   | Rename/replace with `cli/test_land.ts`; cover `--single` and `--dry-run`                                                                                   |
| [`docs/subcommands.md`](../docs/subcommands.md)                   | Replace archive section with land                                                                                                                          |
| [`.opencode/skills/dn/SKILL.md`](../.opencode/skills/dn/SKILL.md) | `prep → loop → meld → land`                                                                                                                                |
| [`docs/opencode.md`](../docs/opencode.md)                         | Rename `dn_archive` skill references to `dn_land` / `dn_land --single`                                                                                     |
| [`README.md`](../README.md), [`AGENTS.md`](../AGENTS.md)          | Replace archive mentions with land                                                                                                                         |
| [`kickstart/orchestrator.ts`](../kickstart/orchestrator.ts)       | Exit hint: "run `dn land`" instead of generic commit guidance                                                                                              |

## Kickstart integration

**Phase 1 (this plan):** standalone `dn land` only.

- Default kickstart exit message points to `dn land`
- Optional follow-up: `dn kickstart --land` chains land after implement + lint
- Optional follow-up: AWP uses land for commit messages instead of `#N title`

## Agent land phase (default mode)

New prompt + orchestration (similar to plan/implement phases):

- Inputs: plan content, optional test plan, `git diff` / `sl diff` summary, file
  list
- Output: structured commit plan (ordered list of `{ files[], message }` with
  conventional-commit subjects)
- Validation: conventional-commit format; every changed file assigned exactly
  once
- Execution: stage per group, commit sequentially; delete plan on full success

Reuse [`deriveCommitMessage`](../sdk/archive/derive.ts) output as a seed/hint
for the agent, not the final message in default mode.

## Acceptance criteria

- [ ] `dn land --single plans/foo.plan.md` matches current `dn archive` behavior
      (message derivation, workspace commit, plan deletion, dry-run,
      restore-on-failure)
- [ ] `dn land` (default) discovers plan file and creates one or more
      conventional commits from dirty workspace
- [ ] `dn archive` removed from CLI; `dn archive` prints helpful "use dn land"
      error or is absent entirely
- [ ] Tests ported from `test_archive.ts` to `test_land.ts` for `--single`; new
      tests for default multi-commit path
- [ ] Docs and skills updated: no remaining user-facing `archive` references
      except git history / this plan
- [ ] `make precommit` passes

## Out of scope

- `dn kickstart --land` auto-chaining (follow-up)
- AWP commit message upgrade (follow-up)
- Moving plan files outside repo after land (was out of scope for archive too)
