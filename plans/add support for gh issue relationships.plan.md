# Add support for Github Issue Relationships

## Overview

Implement end-to-end support for GitHub’s formal issue relationships
(parent/sub-issues, blocking/blocked-by, duplicate-of summaries) so **kickstart
and other workflows** expose that metadata when loading an issue from GitHub,
and callers can mutate dependencies and hierarchy where GitHub exposes stable
APIs.

**Repository status (May 2026):** The bulk of read/write support is already
present (`IssueData.relationships`, GraphQL queries, REST mutations,
`writeIssueContext`, and `dn issue relationship`). Remaining work is primarily
**verification, documentation alignment, UX polish**, and deciding whether to
evolve duplicate handling or expose additional GitHub-only fields (for example
tracked-in-task-list links).

## Issue Context

- Issue: [#196](https://github.com/chesapeakedev/dn/issues/196) (planned as “Add
  support for Github Issue Relationships”)
- Description: Extend kickstart/issue workflows so relationship metadata is
  fetched via GitHub APIs, injected into agent-facing context without
  overwhelming prompts, with optional create/update paths and user-facing docs.
- Labels: dn, cursor awp, high quality

## Implementation Plan

### Phase A — Confirm requirements against current codebase (likely quick)

1. **Read path verification**
   - Confirm `sdk/github/github-gql.ts` `ISSUE_QUERY` and
     `GET_ISSUE_WITH_COMMENTS_QUERY` return the GitHub-documented fields:
     `parent`, `subIssues`, `blockedBy`, `blocking`, `duplicateOf`, and
     `issueDependenciesSummary`
     ([GraphQL schema / changelog — 2025](https://docs.github.com/en/graphql/overview/changelog/2025)).
   - Confirm `fetchIssueFromUrl()` maps responses through
     `mapIssueRelationships()` into `sdk/github/issue.ts` `IssueRelationships`.
   - Confirm **kickstart** writes the temporary issue markdown via
     `writeIssueContext()`, which already appends `## Relationships` with capped
     lists and summary counts (`sdk/github/issue.ts`).

2. **Write path verification**
   - Confirm `sdk/github/issueRelationships.ts` matches current REST endpoints
     for dependencies and sub-issues
     (`/issues/{issue_number}/dependencies/blocked_by`,
     `/issues/{issue_number}/sub_issues`, `/sub_issues/priority`, `/sub_issue`
     DELETE path as implemented).
   - Confirm `cli/issue.ts` `relationship` subcommands call these helpers and
     that `databaseId` resolution via `getIssueIdentifiers()` is sufficient for
     cross-repo blocker/sub-issue cases GitHub allows.

### Phase B — Close product gaps vs issue “Expected State”

3. **Agent prompt ergonomics**
   - **Continuation prompts** in `kickstart/lib.ts` and
     `kickstart/orchestrator.ts` (`_generateContinuationPrompt`) currently list
     only issue number, title, and URL—they do **not** repeat relationships.
     Decide whether:
     - (a) add a compressed relationship bullet block (reuse
       `formatRelationshipDetails`/`writeIssueContext` patterns from
       `cli/issue.ts`), or
     - (b) explicitly tell the continuation agent to reopen the saved
       issue-context file path when present (`--save-ctx` / staged
       paths)—document whichever approach is chosen in `kickstart/README.md`.

4. **Duplicate relationships**
   - Today `dn issue relationship mark-duplicate` posts a **`Duplicate of #…`
     comment** (`cli/issue.ts`), matching older GitHub practice; `duplicateOf`
     is still read via GraphQL when GitHub associates a canonical duplicate.
   - Decide whether to add a GraphQL-backed duplicate mutation if/when
     documented and reliably available from the schema, versus keeping comments
     as the deliberate compatibility layer.

5. **Truncation policy**
   - GraphQL queries use `first: 10` for relationship edges. Either document
     this ceiling in docs and kickstart/agent guidance or make it configurable
     (env/flag) for repos with dense dependency graphs—balance token cost vs
     completeness.

### Phase C — Tests and docs

6. **Tests**
   - `sdk/github/issue_test.ts` covers `writeIssueContext` relationship
     formatting.
   - Add focused tests **only where behavior is non-trivial and stable without
     live API**, for example parsing/formatting summaries or validating REST
     path construction—avoid brittle live GitHub coupling unless the repo
     already uses integration tokens in CI.

7. **Documentation**
   - **`docs/README.md` / guides:** Add or extend a short section describing how
     kickstart/issue context surfaces relationships and points to
     [`docs/subcommands.md`](docs/subcommands.md) relationship examples.
   - **`kickstart/README.md` / `kickstart/system.prompt.plan.md`:** Note that
     fetched issue markdown includes `## Relationships` so planning agents
     prioritize blockers/parent/sub-issues.
   - **`docs/api.md`:** Already sketches `issue.relationships`; keep in sync if
     `IssueRelationships` expands (for example tracked task-list links).

## Acceptance Criteria

- [x] `fetchIssueFromUrl` returns populated `relationships` when GitHub exposes
      them for the issue; PR targets continue to degrade gracefully
      (`empty`-style payloads when not applicable).
- [x] Kickstart (and `--save-ctx` flow) persists issue markdown that includes
      the **Relationships** section consistent with GitHub UI concepts (parent,
      sub-issues, blocked-by/blocking summaries, duplicate-of when present).
- [x] `dn issue show` / `relationship list` expose the same semantic
      relationship data documented for users (`docs/subcommands.md`).
- [x] `dn issue relationship` can add/remove blocking links,
      attach/remove/reprioritize sub-issues via supported REST endpoints;
      failures surface actionable GitHub errors.
- [x] User-facing docs explain how agents should use relationship context
      (prioritization, blocked work) **without assuming unbounded dependency
      lists**.
- [x] `make precommit` passes after any code or doc edits.

## Code Pointers

### Files central to reads

- [`sdk/github/github-gql.ts`](sdk/github/github-gql.ts) (approximately lines
  214–306): `ISSUE_QUERY` with `parent`, `subIssues(first:10)`,
  `blockedBy`/`blocking`, `duplicateOf`, `issueDependenciesSummary`.
- [`sdk/github/github-gql.ts`](sdk/github/github-gql.ts) (approximately lines
  1340–1455): `GET_ISSUE_WITH_COMMENTS_QUERY` mirrors relationship fields for
  `getIssueWithComments()`.
- [`sdk/github/github-gql.ts`](sdk/github/github-gql.ts) (approximately lines
  1807–1869): `mapRelationshipReference`, `mapIssueRelationships()` →
  `IssueRelationships`.
- [`sdk/github/github-gql.ts`](sdk/github/github-gql.ts) (approximately lines
  1029–1154): `fetchIssueFromUrl()` assembly of `IssueData`.

### Issue model and markdown surfacing

- [`sdk/github/issue.ts`](sdk/github/issue.ts): `IssueRelationships`,
  `IssueData.relationships`, `emptyIssueRelationships()`, `writeIssueContext()`
  (**Lines ~216–295:** `## Relationships` formatting and truncation notices).

### Writes and CLI

- [`sdk/github/issueRelationships.ts`](sdk/github/issueRelationships.ts): REST
  wrappers for blocking and sub-issue lifecycle.
- [`cli/issue.ts`](cli/issue.ts) (approximately lines 170–290, 930–1277):
  Relationship display helpers and `relationship` subcommand routing (including
  comment-based duplicate marking).

### Kickstart orchestration

- [`kickstart/orchestrator.ts`](kickstart/orchestrator.ts) and
  [`kickstart/lib.ts`](kickstart/lib.ts):
  `writeIssueContext(issueData, issueContextPath…)` near combined prompt
  assembly; **`_generateContinuationPrompt`** (approximately lines 1554–1615 in
  `lib.ts`, 444–516 in `orchestrator.ts`) for optional relationship uplift.

### Public SDK exports

- [`sdk/mod.ts`](sdk/mod.ts) (approximately lines 254–335): exports for
  `IssueData`, relationship types, REST helpers.

### Existing tests / docs touchpoints

- [`sdk/github/issue_test.ts`](sdk/github/issue_test.ts): relationship-aware
  `writeIssueContext` assertions.
- [`docs/subcommands.md`](docs/subcommands.md) (`dn issue relationship` examples
  and `dn issue show` relationship note).

### Files to create (optional, only if new scope emerges)

- New focused test modules under `sdk/github/` **only if** mapping or formatting
  logic grows beyond current coverage.

## Notes

- **REST vs GraphQL for writes:** The codebase favors **REST** for
  dependency/sub-issue mutations (`issueRelationships.ts`). GitHub also
  documents **GraphQL** `addBlockedBy` / `removeBlockedBy`; switching is
  optional unless REST gaps appear—keep mutations minimal-risk.
- **GitHub docs:** Prefer official references when extending behavior:
  [GitHub GraphQL changelog (2025)](https://docs.github.com/en/graphql/overview/changelog/2025)
  covers `IssueDependenciesSummary`, `blockedBy`/`blocking` fields and related
  mutations; sub-issues are described in GitHub engineering/product posts and
  schema introspection alongside REST sub-issue endpoints already used here.
- **Additional read-only surfaces (future):** GitHub exposes **tracked**
  relationships on issues (task-list backlinks) separately from
  blocker/sub-issue edges; Issue #196 did not mandate them—investigate
  `trackedIssues` / `trackedInIssues` only if product wants that signal in
  prompts.
- **Assumption:** Closing #196 does **not** require automatic creation of
  relationships from LLM output unless stakeholders add that scope; current CLI
  already supports deliberate human/agent-driven edits.
