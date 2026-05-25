# dn glance improvements

## Overview

Improve `dn glance` so the terminal report is easier to scan and conveys
stronger velocity and health signals (trends vs a prior window, contributors
with share of activity, optional compact/no-URL modes, and graceful handling
aligned with global CLI output policy). Add a new **`dn peek`** subcommand that
lists the top **three open issues** the user should consider next, using
**deterministic heuristic scoring** (no LLM)—reusing SDK GitHub primitives and
staying consistent with documented global flags (`--no-color`, `--unattended`).

## Issue Context

- Issue: [#192](https://github.com/chesapeake-computing/dn/issues/192) (as
  provided in planner context)
- Description: Enhance `dn glance` (visual polish, richer metrics,
  grouping/truncation/flags). Introduce `dn peek` suggesting the next three
  issues to prioritize from activity/heuristic signals. Initial weights in the
  ticket: age 30d+, no assignee, bug-type label, recent comments, staleness
  14+d, maintainer-authored boost.
- Labels: denoise, cursor plan + debug

## Implementation Plan

### Phase A — `dn glance` data and types

1. **Dual time windows for trends**

   Today `cli/glance.ts` computes one `[start, end)` window from `--days`. For
   trend arrows (↑↓→), also fetch aggregates for the **immediately preceding**
   window of equal length (e.g. if `days === 7`, compare last 7 days vs the 7
   days before that).

   - Extend `VelocityData` in `glance/types.ts` with optional summaries, e.g.:
     - Prior-window counts (`issuesOpened`, `issuesClosed`, `commits`).
     - Derived rates: issues/day, commits/day for current vs prior window.
     - Simple trend enums or signed deltas per metric (`"up" | "down" | "flat"`
       using a small threshold).
   - Implement helpers in `glance/gh.ts` (or `glance/aggregate.ts` if the file
     grows): run the same three fetches (`fetchIssuesOpened`,
     `fetchIssuesClosed`, `fetchCommits`) with shifted `since`/`until`
     semantics, or call existing fetchers twice with adjusted `since` dates.
     **Note:** `fetchIssuesOpened`/`Closed` filter by API returns; clarify
     “window” semantics in code (exclusive start, inclusive-ish end = now).

2. **Net issue flow (health)**

   Within the chosen window: `openedCount - closedCount`. Surface as a signed
   number and optional word (“backlog grew” vs “burned down”). No new API if
   opened/closed lists already define the window.

3. **Hot issues (recent activity)**

   Heuristic compatible with current data:

   - Sort opened/closed lists by recency (`createdAt` / `closedAt`) and badge
     the top N, or
   - Prefer issues whose `updatedAt` would be available if you extend payloads
     (see Phase C).

   If only `Issue` minimal fields exist, define “hot” as **opened or closed
   inside the window** with **recent** `createdAt`/`closedAt` timestamps (e.g.
   last 48h)—document the definition in TSDoc.

4. **Contributor percentages**

   Reuse `aggregateUserActivity()` in `glance/gh.ts`. After computing totals per
   user, add **share of window activity** (% of total countable events = opens +
   closes + commits, or separate rows per dimension—pick one and document).

5. **Optional: rolling / sparkline-ready series**

   If cheap: bucket counts per day inside the window (7 buckets when
   `days === 7`) for commits and issue events, and render ASCII sparklines in
   `glance/format.ts`. If costly (extra pagination), defer to a follow-up and
   document under Notes.

### Phase B — `dn glance` formatting and CLI flags

6. **Respect global output policy**

   `bootstrapFromEnv()` in `cli/main.ts` already runs before subcommands; use
   **`isColorEnabled()`** and **`isUnattended()`** from `sdk/github/output.ts`
   (same primitives as `cli/output.ts`) inside formatting so:

   - Color and box-drawing apply when stdout is TTY + color enabled + not
     unattended.
   - Unattended/CI: ASCII tables, `[dn]` prefixes where helpful, no
     emoji-dependent layout.

7. **ANSI styling**

   Add small helpers local to `glance/format.ts` (or reuse patterns from
   `cli/output.ts` without importing circularly) so headers, deltas, and “hot”
   lines can use bold/dim/green/red only when allowed.

8. **Relative times**

   Replace or supplement `toLocaleDateString` for issue lines with compact
   **relative phrases** (“2d ago”) from `createdAt`/`closedAt` ISO strings
   (`Intl.RelativeTimeFormat` or minimal manual day math—keep dependency-free).

9. **Progress / micro-charts**

   Optional one-line ASCII progress bars for share of commits vs max
   contributor, or for issues opened vs closed (bounded width ~20–25 cols).

10. **Truncation**

    Truncate titles beyond a sane width (e.g. 72) with ellipsis; full title
    available via URL line or omit URL when `--no-urls`.

11. **New `dn glance` flags** (parsed in `cli/glance.ts`, threaded into
    `formatVelocity`):

    - `--compact` — fewer blank lines, shorter section headers.
    - `--no-urls` — omit URLs for issues/commits (titles + numbers only).
    - Optionally `--no-progress` / `--sparkline` toggles if those features ship.

12. **`glance/main.ts` parity**

    The standalone `glance/main.ts` entry duplicates logic vs `cli/glance.ts`.
    Either:

    - factor shared orchestration into `glance/mod.ts` (e.g. `runGlance(opts)`)
      and call from both, or
    - document that standalone `glance` lags CLI and keep duplication minimal.

    Prefer one code path for behavior parity.

13. **Error handling**

    Match other subcommands: catch auth/repo errors and print actionable
    messages (“run `dn auth` or `gh auth login`”, “not a GitHub-backed repo”).
    Use `formatError` / `formatWarning` from `cli/output.ts` where stderr
    messaging is improved; avoid stack traces for expected failures.

14. **Docs**

    Update `docs/subcommands.md` (and briefly `docs/README.md` if user-facing
    summaries live there) with new flags and `dn peek`.

### Phase C — Supporting SDK/data extensions (only if needed for acceptance)

15. **Labels on velocity `Issue` rows**

    Today `sdk/github/types.ts` `Issue` has no `labels`. If acceptance requires
    **grouping by label**:

    - Extend the underlying query used by `fetchAllIssues`/velocity fetchers to
      include labels, widen the mapped type (or introduce `IssueWithLabels`
      consumed only by glance) and thread through `glance/types.ts`.

16. **`updatedAt` for “hot” and staleness**

    If product definition needs **staleness by last issue update**, add
    `updatedAt` to the same payloads.

### Phase D — `dn peek` (new command)

17. **CLI wiring**

    - Add `cli/peek.ts` with `handlePeek(args: string[])`, mirroring
      `handleGlance` structure.
    - Register `peek` in `cli/main.ts` (`switch`, `showUsage`, subcommand
      descriptions).
    - Parse `--days`, `--limit` (default **3**), `--help`; pass through
      bootstrap flags implicitly via env (no interactive prompts).

18. **Data fetch**

    - Use `listIssues(owner, repo, { state: "open", limit: configurable })` from
      `sdk/mod.ts` (~`sdk/github/github-gql.ts`). Default limit must be enough
      to score meaningful candidates (e.g. 50–100); document `--limit` API cap
      alignment with GitHub paging.

19. **Heuristic scoring (no LLM)**

    Implement `peek/scorePeek.ts` (or under `glance/peek.ts`):

    - Normalize dates from ISO strings (`createdAt`, `updatedAt`).
    - **Age ≥ 30 days** — boost (from `createdAt`).
    - **No assignees** — boost (`assignees.length === 0`).
    - **Bug** — boost if labels match case-insensitive `bug`/repo’s convention
      (document reliance on label names).
    - **Staleness** — boost if `updatedAt` older than **14 days** (requires
      `updatedAt` on list items—already on `IssueListItem`).
    - **Recent discussion** — optional boost if **`comments.totalCount`** (or
      similar) is added to `LIST_ISSUES_FILTERED_QUERY` and `IssueListItem`;
      otherwise use **rapid `updatedAt` changes vs `createdAt`** as a proxy in
      v1.

    Exclude issues that should never be prioritized (closed—already excluded;
    optional `--include-all` deferred).

20. **Output**

    - Render top 3 (or `--limit`) with rank, score (optional `--verbose`), title
      (truncated), `#number`, labels, assignees summary, optional URL with
      `--no-urls` analogue.
    - Respect color/unattended same as glance.

21. **`kickstart/score.ts`**

    Existing `runScoring` is **LLM-based** for Fibonacci scores; **`dn peek`
    should not invoke it by default.** Optionally document future `--llm-score`
    hook as out of scope unless explicitly requested.

22. **Tests**

    Unit-test pure helpers: trend direction from two numbers, relative time
    formatter, truncation, and peek scoring with fixed `IssueListItem[]`
    fixtures (no network).

### Suggested implementation order

1. Types + dual-window aggregates + formatting with policy-aware ANSI/ASCII.
2. Flags `--compact`, `--no-urls`, truncation, contributor %.
3. SDK/issue field extensions **only when** grouping or comment-based signals
   require them.
4. `dn peek` scaffolding + heuristic score + docs.

## Acceptance Criteria

- [x] `dn glance` output is visually improved (layout, optional color,
      unattended-safe fallback).
- [x] `dn glance` shows velocity-style rates (issues/day, commits/day) for the
      selected window.
- [x] `dn glance` compares the current window to the prior equal-length window
      and shows trend indicators.
- [x] `dn glance` shows net issue flow (opened − closed) for the window.
- [x] `dn glance` surfaces contributor breakdown with percentages (or documented
      equivalent).
- [x] `dn glance` supports `--compact` and `--no-urls` (and documents them).
- [x] `dn glance` truncates very long titles and uses relative-time phrasing
      where appropriate.
- [x] `dn glance` fails gracefully on missing auth / non-GitHub repo (consistent
      messaging, non-zero exit).
- [x] `dn peek` exists, registered in CLI help/usage, and prints **exactly
      three** (or `--limit`) suggested open issues with heuristic rationale
      fields or scores (verbosity flag optional).
- [x] Both commands honor global `--no-color`, `--color`, `--unattended` / CI
      behavior via existing output bootstrap.
- [x] `make precommit` passes; new pure logic covered by targeted unit tests.

## Code Pointers

### Files to Modify

- `cli/main.ts`: register `peek` subcommand, usage strings.
- `cli/glance.ts`: extended arg parsing (`--compact`, `--no-urls`, optional
  `--no-progress`), dual-window fetch orchestration or delegate to glance
  module.
- `glance/types.ts`: extend `VelocityData`; add peek-specific types
  (`PeekCandidate`, `TrendDirection`) if needed.
- `glance/gh.ts`: optional new aggregation exports; avoid breaking
  `glance/mod.ts` public exports unless intentional.
- `glance/format.ts`: `formatVelocity` signature gains options ({ compact,
  noUrls, sparkline, … }); color/time/truncation helpers.
- `glance/mod.ts`: export any new orchestration helpers shared with
  `glance/main.ts`.
- `glance/main.ts`: align with shared implementation or deprecate duplication
  (note in README if kept for `deno run`).
- `sdk/github/github-gql.ts` + `sdk/github/types.ts` / `sdk/mod.ts`: extend
  `Issue`/`IssueListItem` + queries only if labels, comment counts, or extra
  fields are required.
- `docs/subcommands.md` (+ `docs/README.md` section for glance/peek if present).

### Files to Create

- `cli/peek.ts`: `handlePeek` entry.
- `glance/peekScore.ts` (or `peek/scorePeek.ts`): deterministic scoring over
  `IssueListItem[]`.
- `glance/peekFormat.ts` (optional): keep `format.ts` from growing unbounded.

## Notes

- **Correct paths**: Issue draft cited `dn/glance/*`; the repo uses
  **`glance/*.ts`** and **`cli/glance.ts`**. SDK lives under **`sdk/`** (e.g.
  `listIssues`, `fetchIssuesOpened`, `getIssueWithComments` in
  `sdk/github/github-gql.ts`).
- **LLM scoring**: `dn tidy` / kickstart use `kickstart/score.ts` for Fibonacci
  prioritization—that path is orthogonal; `peek` stays heuristic unless product
  asks otherwise.
- **Assumptions**: “Bug” detection uses label name heuristics; repos using only
  issue types might need GraphQL IssueType fields in a later iteration.
- **`getIssueWithComments`**: Prefer **not** N+1 fan-out for peek; extend list
  query once if comment volume matters.
- **Questions file**: `.opencode-answers.json` was absent; proceeding with
  sensible defaults above.
