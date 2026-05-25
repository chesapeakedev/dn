# dn meld improvements

## Overview

Extend `dn meld` so merged source content can be written to multiple output
types—not only `plans/*.plan.md` files. Add `--target` (output destination) and
`--overwrite` (replace vs merge), target-specific agent prompts that produce
condensed summaries for long-lived docs like `AGENTS.md`, and interactive
confirmations before creating or overwriting files. Explore GitHub issue
body/comment as an output target to reduce copy/paste between research, tickets,
and repo docs.

## Issue Context

- Issue: #190
- Description: Modify `dn meld` to support output formats beyond markdown plan
  files. Given a set of sources, merge content into targets such as `README.md`,
  `CONTRIBUTING.md`, and `AGENTS.md` (and other sensible paths). Add `--target`
  and `--overwrite` flags. Explore GitHub issue description/comment as an output
  channel so agents can enrich project tracking context on the user's behalf.
- Labels: dn, denoise, high quality

## Implementation Plan

### 1. Current state and gap analysis

Today `dn meld` (`cli/meld.ts`) does three things:

1. Resolves and merges sources via `sdk/meld/*` (`resolveSource`,
   `mergeMarkdown`, `ensureAcceptanceCriteriaSection`, etc.).
2. Writes merged markdown to `--output` or a temp file.
3. **Always** calls `runPlanPhase()` from `kickstart/lib.ts`, which runs the
   plan-phase agent and writes `plans/<name>.plan.md`.

The plan phase is hard-wired to `system.prompt.plan.md` and validates output
with `checkPlanFile()`. OpenCode plan permissions in `opencode.plan.json` only
allow editing `**/*.plan.md` under `plans/`.

`dn prep` overlaps with meld for the single-source case: it accepts one issue
URL, issue number, or markdown file and runs the same plan phase. Meld adds
multi-source merge before plan phase.

`cli/test_meld.ts` references flags (`--trim`, `--deduplicate`) that are not
implemented in `cli/meld.ts`; tests and implementation are out of sync and
should be reconciled during this work.

### 2. Target model and CLI surface

Introduce a **meld target** abstraction in `sdk/meld/target.ts`:

```typescript
type MeldTargetKind =
  | "plan" // plans/*.plan.md (default, current behavior)
  | "readme" // README.md
  | "contributing" // CONTRIBUTING.md (root; also check docs/CONTRIBUTING.md)
  | "agents" // AGENTS.md
  | "markdown" // arbitrary *.md path via --target
  | "github-issue" // update issue body (exploratory)
  | "github-comment"; // append issue comment (exploratory);
```

**New CLI flags** (add to `cli/meld.ts`):

| Flag                      | Purpose                                                                                                                                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--target <path-or-kind>` | Output destination. Examples: `README.md`, `AGENTS.md`, `plans/foo.plan.md`, `github:issue:123`, `github:comment:123`. When omitted, preserve current default (plan phase → `plans/<name>.plan.md`). |
| `--overwrite`             | Replace existing target content instead of merging/editing in place. Skips the overwrite confirmation prompt.                                                                                        |
| `--dry-run`               | Preview agent output or GitHub payload without writing (reuse pattern from `prep --update-issue --dry-run`).                                                                                         |
| `--yes`, `-y`             | Non-interactive: auto-confirm create/overwrite when combined with `--overwrite` or explicit unattended policy (see §4).                                                                              |

**Backward compatibility:**

- `dn meld a.md b.md` → unchanged (plan output).
- `--output, -o` continues to write the **merged source context** (pre-agent) to
  a file; distinct from `--target` (agent output destination). Document clearly:
  `-o` = intermediate merged input; `--target` = final agent-written artifact.
- `--plan-name` remains valid when target kind is `plan`.

**Target resolution rules:**

1. If `--target` ends with `.plan.md` or is under `plans/`, use plan kind +
   existing `checkPlanFile()` validation.
2. If `--target` is a known basename (`README.md`, `AGENTS.md`,
   `CONTRIBUTING.md`), map to corresponding kind and resolve relative to
   `--workspace-root`.
3. If `--target` matches `github:issue:<ref>` or `github:comment:<ref>`, parse
   ref (number, URL) and use GitHub output path.
4. Otherwise treat as generic markdown file path.

Export public types/helpers from `sdk/mod.ts` only if needed by downstream SDK
consumers; keep most logic internal to `sdk/meld/`.

### 3. Meld phase orchestration (shared with plan phase)

Extract a new function `runMeldPhase()` in `kickstart/lib.ts` (or
`kickstart/meldPhase.ts` if the file grows too large). It generalizes
`runPlanPhase()`:

```
resolve sources → merge markdown → resolve target path/kind
→ prompt create/overwrite (§4)
→ load target-specific system prompt
→ assemble combined prompt (include existing target file as "Previous Content")
→ run agent (readonly config)
→ validate output per target kind
→ write file OR call GitHub API
```

**Inputs:** `MeldPhaseConfig` extending relevant fields from `KickstartConfig`:

- `sources` / `contextMarkdownPath` (merged context)
- `targetPath`, `targetKind`, `overwrite`, `dryRun`
- `agentHarness`, `workspaceRoot`, `savedPlanName` (plan targets only)

**Outputs:** `MeldPhaseResult` with `outputPath`, `targetKind`, temp artifacts.

Refactor `runPlanPhase()` to call `runMeldPhase()` with `targetKind: "plan"` to
avoid duplicating agent invocation, temp dir handling, and error formatting.
Keep `runPlanPhase` signature stable for `prep`, `kickstart`, and existing
callers.

Update `cli/meld.ts` to call `runMeldPhase()` instead of manually merging then
calling `runPlanPhase()`.

### 4. Interactive prompts (create / overwrite)

Issue requires user confirmation before creating or overwriting a target file.

Add shared helpers in `sdk/github/prompt.ts` or `cli/prompt.ts`:

```typescript
function promptYesNo(message: string, defaultNo: boolean): boolean;
function promptConfirmCreate(path: string): boolean; // default: no
function promptConfirmOverwrite(path: string): boolean; // default: no
```

**Behavior matrix:**

| Scenario                        | TTY + attended                                                                                            | Unattended / CI                           |
| ------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Target file missing             | Prompt: "Create `<path>`?" (default no)                                                                   | Fail unless `--yes` or env `DN_YES=1`     |
| Target exists, no `--overwrite` | Prompt: "Merge into existing `<path>`?" (default yes for merge mode) OR "Overwrite?" if semantics require | Fail with message to pass `--overwrite`   |
| Target exists, `--overwrite`    | Prompt unless `--yes` (default no for overwrite)                                                          | Require `--overwrite --yes` in unattended |

Use existing `isUnattended()` from `sdk/github/output.ts` (CI, non-TTY, or
explicit flag). Never call `prompt()` in unattended mode—match
`system.prompt.plan.md` non-interactive guidance.

For plan targets, keep existing `promptContinueOrNewPlan()` when continuing an
existing plan without `--overwrite`.

### 5. Target-specific system prompts

Create new prompt files under `kickstart/` (included via
`readIncludedPrompt()`):

| File                                   | When used                | Key instructions                                                                                                                                                                                         |
| -------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `system.prompt.plan.md`                | Plan targets (existing)  | No change to core behavior                                                                                                                                                                               |
| `system.prompt.meld.readme.md`         | `README.md`              | Merge sources into user-facing README; preserve project voice; update relevant sections only; do not dump raw sources                                                                                    |
| `system.prompt.meld.contributing.md`   | `CONTRIBUTING.md`        | Same merge discipline for contributor docs                                                                                                                                                               |
| `system.prompt.meld.agents.md`         | `AGENTS.md`              | **Condense** source material into agent guidelines; never paste full issue bodies or long research notes; prefer bullet summaries, links, and section updates; reuse structure from existing `AGENTS.md` |
| `system.prompt.meld.markdown.md`       | Generic `.md` `--target` | Merge/edit with summary-first approach                                                                                                                                                                   |
| `system.prompt.meld.github-issue.md`   | `github:issue:*`         | Produce updated issue body sections; preserve non-empty user content (reuse `parseIssueBody` / `isEmptySection` patterns from `fillEmptyIssueSections`)                                                  |
| `system.prompt.meld.github-comment.md` | `github:comment:*`       | Produce append-only comment summarizing merged sources for progress/handoff                                                                                                                              |

Each prompt must include:

- READ-ONLY mode except for the single target output path
- Non-interactive / headless rules (`.opencode-questions.json` protocol)
- Explicit output path instruction (same pattern as plan phase)
- **Summary mandate:** "Create shortened summaries of source content; do not
  copy whole sources verbatim into long-lived files (especially AGENTS.md)"

When target file exists and `--overwrite` is false, pass existing content as
`Previous Content` section in `assembleCombinedPrompt()` (extend signature to
accept optional `existingTargetContent`).

### 6. Output validation per target kind

| Kind                                           | Validation                                                                          |
| ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| `plan`                                         | Existing `checkPlanFile()` (H1, Overview, Implementation Plan, Acceptance Criteria) |
| `readme`, `contributing`, `agents`, `markdown` | File exists, non-empty, valid UTF-8; optional max-size sanity check                 |
| `github-issue`                                 | Body non-empty; dry-run prints diff preview                                         |
| `github-comment`                               | Comment body non-empty; dry-run prints preview                                      |

Add `checkMeldOutput(targetKind, path)` in `sdk/meld/validate.ts`.

### 7. OpenCode / agent permissions

When meld target is outside `plans/*.plan.md`, dynamically extend
`opencode.plan.json` edit permissions for the resolved target path (mirror
existing logic in `sdk/github/opencode.ts` that adds plan file permissions).

For each run, allow editing only:

- The specific target file path (workspace-relative glob)
- Temp files under `/tmp/**`

Do **not** widen to `*`: allow` globally.

Apply the same path-scoping for Cursor/Claude/Codex harnesses where config files
restrict write scope.

### 8. GitHub issue/comment output (exploratory, phase 2)

Implement after filesystem targets are stable.

**Issue body update** (`--target github:issue:123`):

- Fetch issue via `fetchIssueFromUrl` / `resolveIssueUrlInput`
- Run `system.prompt.meld.github-issue.md` with merged sources + current body
- Call `updateIssue()` (reuse from `sdk/github/github-gql.ts`) unless
  `--dry-run`
- Respect section preservation rules from `fillEmptyIssueSections`—do not
  clobber filled template sections unless `--overwrite`

**Issue comment** (`--target github:comment:123`):

- Run comment prompt; call `addIssueComment()`
- Always append-only (safe default per AGENTS.md issue guidance)
- Print comment URL on success

**Unattended:** require `--yes` and explicit `--target`; no interactive confirm
for GitHub writes beyond dry-run preview.

This directly addresses the workflow pain in the issue: research → ticket update
without manual copy/paste.

### 9. `--list` format decision

**Decision: keep newline-separated lists** (current implementation in
`cli/meld.ts` lines 94–97). This matches Unix convention, git-style path lists,
and avoids comma-in-path ambiguity.

Action items:

- Audit `docs/subcommands.md` and `--help` text for any comma-separated wording;
  align docs to newline-separated.
- Add one doc example showing a `sources.txt` file with one source per line.
- Do **not** change the parser to comma-separated unless a separate
  `--list-delimiter` flag is added later.

### 10. `dn prep` vs `dn meld` relationship

**Decision for v1: do not merge CLI commands.** Overlap is real but user mental
models differ:

- `prep` = "plan this one thing" (issue or single markdown file)
- `meld` = "combine these sources, then produce output"

**Do** refactor shared internals:

- Both call `runMeldPhase()` / `runPlanPhase()` with appropriate config
- Optionally implement `prep` as thin wrapper:
  `meld --target plan <single-source>` internally (no user-facing change)

Document in `docs/subcommands.md`:

- When to use `prep` vs `meld`
- That `dn meld issue.md --target plan` ≈ `dn prep issue.md` for single source

Defer full CLI unification to a follow-up issue if desired.

### 11. Tests

Update and extend `cli/test_meld.ts`:

1. Fix stale tests referencing `--trim` / `--deduplicate` (either remove or
   implement if still desired—**recommend remove** from tests unless issue scope
   expands).
2. Add unit tests for `sdk/meld/target.ts` (path/kind resolution).
3. Add tests for prompt gating logic (mock `isUnattended`, verify fail without
   `--yes` in unattended mode).
4. Integration tests with mocked agent runner for each target kind (inject test
   harness that writes fixture output).
5. GitHub target tests: mock `updateIssue` / `addIssueComment` (pattern from
   existing issue CLI tests if present).

Run `make precommit` before completion.

### 12. Documentation

Update:

- `docs/subcommands.md` — meld section: `--target`, `--overwrite`, `--dry-run`,
  target examples, `-o` vs `--target` distinction, `--list` newline format
- `cli/meld.ts` `showHelp()` — mirror docs
- `docs/README.md` — brief mention if public behavior changes materially
- `AGENTS.md` — add `dn meld` examples for doc enrichment workflow (optional,
  only if examples are stable)

### 13. Suggested implementation order

1. `sdk/meld/target.ts` + validation + shared prompt helpers
2. `runMeldPhase()` refactor; wire plan target (no behavior change)
3. `--target` for `AGENTS.md`, `README.md`, `CONTRIBUTING.md`
4. Interactive create/overwrite prompts + unattended policy
5. OpenCode permission scoping for non-plan targets
6. GitHub issue/comment targets + `--dry-run`
7. Tests, docs, `make precommit`

## Acceptance Criteria

- [x] `dn meld` supports multiple output target types: plan (default),
      `README.md`, `CONTRIBUTING.md`, `AGENTS.md`, and arbitrary markdown paths
      via `--target`
- [x] `--target <path>` directs the agent to create or merge content into the
      specified file instead of always producing `plans/*.plan.md`
- [x] `--overwrite` replaces existing target content; without it the agent
      merges/edits in place using existing file as context
- [x] Target-specific system prompts instruct the agent to produce **shortened
      summaries** of source content, not verbatim copies of full sources
      (especially for `AGENTS.md`)
- [x] User is prompted before overwriting an existing target file (unless
      `--overwrite` and unattended policy satisfied)
- [x] User is prompted before creating a new target file (unless `--yes` /
      unattended policy satisfied)
- [x] `--list` / `-l` remains newline-separated; documentation matches
      implementation
- [x] `-o` / `--output` and `--target` are documented as distinct (merged
      context vs agent output)
- [x] OpenCode plan permissions are scoped to the resolved target path for
      non-plan meld runs
- [x] GitHub issue body update and/or comment output is implemented or
      explicitly scoped as follow-up with `--target github:issue:*` /
      `github:comment:*` and `--dry-run` preview
- [x] Shared meld/plan orchestration is refactored so `prep` and `meld` reuse
      `runMeldPhase()` internals without breaking existing `prep` / `kickstart`
      behavior
- [x] `cli/test_meld.ts` is updated to match actual flags and cover new
      target/prompt behavior
- [x] `docs/subcommands.md` and `dn meld --help` document new flags and examples
- [x] `make precommit` passes

## Code Pointers

### Files to Modify

- `cli/meld.ts` (lines 32–226): Add `--target`, `--overwrite`, `--dry-run`,
  `--yes`; call `runMeldPhase()` instead of direct `runPlanPhase()`; update help
  text
- `kickstart/lib.ts` (lines 782–975): Extract/generalize to `runMeldPhase()`;
  parameterize system prompt selection and output validation by target kind
- `sdk/github/prompt.ts` (lines 23–108): Extend `assembleCombinedPrompt()` to
  accept optional existing target content section
- `sdk/github/opencode.ts` (lines 72–134): Generalize plan-file permission
  injection to accept arbitrary target path globs
- `sdk/mod.ts` (lines 350–359): Export new meld target types/helpers if part of
  public SDK surface
- `docs/subcommands.md` (lines 399–432): Document new meld behavior, `--list`
  format, prep vs meld guidance
- `cli/test_meld.ts`: Reconcile with implementation; add target/prompt tests
- `opencode.plan.json`: May remain template-only; runtime permission patching
  preferred over static broad allows

### Files to Create

- `sdk/meld/target.ts`: Target kind enum, path resolution, GitHub target parsing
  (`github:issue:123`, `github:comment:123`)
- `sdk/meld/validate.ts`: Post-agent validation per target kind
- `sdk/meld/prompts.ts`: Map target kind → system prompt filename
- `kickstart/system.prompt.meld.readme.md`: README merge prompt
- `kickstart/system.prompt.meld.contributing.md`: CONTRIBUTING merge prompt
- `kickstart/system.prompt.meld.agents.md`: AGENTS.md merge prompt with summary
  mandate
- `kickstart/system.prompt.meld.markdown.md`: Generic markdown merge prompt
- `kickstart/system.prompt.meld.github-issue.md`: Issue body update prompt
  (phase 2)
- `kickstart/system.prompt.meld.github-comment.md`: Issue comment append prompt
  (phase 2)
- `cli/prompt.ts` or `sdk/github/confirm.ts`: Shared `promptYesNo` and
  create/overwrite confirm helpers (extract from `cli/kickstart.ts` pattern)

### Files to Reference (reuse, minimal changes)

- `kickstart/lib.ts` (`fillEmptyIssueSections`, lines 1479+): Section
  preservation for GitHub issue body targets
- `kickstart/artifacts.ts` (`generateAgentsMd`, `mergeAgentsMd`): Existing
  AGENTS.md merge heuristics—inform prompt design, not necessarily invoked
  directly
- `sdk/github/github-gql.ts` (`updateIssue`, `addIssueComment`): GitHub output
- `cli/prep.ts`: Keep as thin entrypoint; share orchestration via
  `runMeldPhase()`
- `sdk/meld/merge.ts`, `acceptance.ts`: Unchanged source merge pipeline before
  agent phase

## Notes

### Assumptions

- Default behavior (no `--target`) remains plan output for backward
  compatibility.
- `--overwrite` means "replace entire file" for doc targets; without it the
  agent performs intelligent merge using existing content as context.
- Unattended/CI runs fail closed: require explicit `--overwrite --yes` (or
  `DN_YES=1`) rather than silently overwriting files.
- `CONTRIBUTING.md` resolves to repo root (`CONTRIBUTING.md`); if missing, fall
  back to `docs/CONTRIBUTING.md` when that file exists.
- GitHub output uses the user's existing GitHub token (`resolveGitHubToken`); no
  new auth mechanism required.

### Open questions (defaults chosen for implementation)

| Question                                           | Default                                                                                                     |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Merge `dn prep` into `dn meld` CLI?                | No for v1; share internals only                                                                             |
| `--list` comma vs newline?                         | Newline (keep current)                                                                                      |
| GitHub output in v1 or follow-up?                  | Filesystem targets first; GitHub in same PR if time permits, otherwise immediate follow-up with `--dry-run` |
| Add `--trim` / `--deduplicate` flags tests expect? | Remove from tests unless explicitly requested; merge logic already deduplicates in `sdk/meld/`              |

### Out of scope

- Changing `dn loop` to consume non-plan meld outputs
- Automatic staging/commit of meld outputs (`dn archive` integration)
- Formal YAML schema for Cursor frontmatter on non-plan targets
