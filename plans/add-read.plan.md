# Add read-only pull request review brief operation to dn

## Overview

Add a read-only `dn read` capability and corresponding SDK API that accepts a
GitHub pull request reference, gathers the PR metadata, source changes, checks,
reviews, and repository context, and asks the configured agent to produce a
concise review brief. The operation must never edit the checkout, switch
branches, publish to GitHub, or modify PR/CI state. Its primary output is a
versioned, machine-readable document suitable for Denoise caching and
invalidation, with an optional human-readable rendering for terminal users.

## Issue Context

- Issue: #517
- Description: Add a read-only operation answering what a pull request does and
  whether it is likely to merge, based on observable GitHub and repository
  evidence.
- Labels: `dn`
- Relationships: No parent, sub-issues, blockers, or duplicates.
- Required safety: Do not modify files, branches, PR metadata, comments,
  reviews, or CI state.

## Implementation Plan

1. Define the public review-brief contract in a focused SDK module. Include a
   schema/version, normalized PR identity (`owner`, `repo`, `number`, canonical
   URL), head SHA, base/head refs, and a canonical input representation or
   digest. Model the two conclusions separately: a plain-language description of
   the change and a qualified merge outlook. Represent supporting signals as
   typed fact records with source, value, and completeness where useful, and
   represent warnings/limitations and structured error categories explicitly.
   Keep agent judgment distinct from fetched GitHub facts so consumers can tell
   evidence from inference.

2. Extend the GitHub GraphQL layer in `sdk/github/github-gql.ts` with a
   read-only pull-request query that returns the data needed for the contract:
   head SHA and ref, base ref/SHA, state, draft status, mergeability, review
   decision, status/check conclusions, approvals and requested changes, review
   threads or unresolved review indicators where available, commit/file
   summaries, and existing conversation/review content. Preserve pagination and
   mark omitted or unavailable connections as warnings rather than silently
   treating incomplete data as an absence of concerns. Reuse
   `parsePullRequestUrl`, `getClient`, `handleGraphQLErrors`, and the existing
   token resolver so invalid URLs, inaccessible repositories/PRs, and missing
   credentials have actionable structured failures.

3. Add a deterministic input-normalization and brief-generation pipeline. Sort
   and normalize all fetched fields before serializing them, compute a stable
   digest over the canonical PR identity, head SHA, relevant GitHub signals,
   review material, and source-change representation, and include the digest in
   the result. Use the SHA and digest as cache/invalidation identity; do not use
   timestamps or agent prose as the sole source identity.

4. Provide repository-change context without mutating the caller's checkout.
   Prefer read-only GitHub-provided commit/file/patch data; if the selected
   agent requires a local checkout to understand the change, create an isolated
   temporary analysis workspace or otherwise use a read-only VCS invocation.
   Never call branch checkout, commit, push, PR mutation, review/comment, or CI
   APIs. Clean up temporary resources on success and failure and record a
   warning when GitHub cannot provide complete diff context.

5. Reuse the configured runtime and agent model resolution from
   `sdk/config/localAgent.ts` and `sdk/github/agentHarness.ts`. Add a dedicated
   read/review system prompt under `kickstart/` that instructs the agent to
   analyze only supplied repository/PR context, distinguish facts from judgment,
   answer the two required questions, avoid all mutations, and emit only the
   versioned JSON result. Run it through the read-only agent configuration
   (`useReadonlyConfig: true`) with stdin disabled, and validate and normalize
   the agent response before returning it. Agent failures or malformed output
   must become explicit structured errors/warnings rather than an apparently
   successful brief.

6. Add `cli/read.ts` with a non-interactive `dn read` handler. Support a
   specific PR URL and, where consistent with existing issue commands, a PR
   number resolved against the current GitHub remote. Add `--json` for the
   machine-readable contract, a concise default terminal rendering, `--agent`
   and context/workspace options needed by the existing runtime, and `--help`.
   Reject unsupported mutation/publish options. Route errors through existing
   CLI formatting and return non-zero status for invalid references, unavailable
   credentials, inaccessible PRs, missing repository configuration, incomplete
   required identity, or agent/contract failures.

7. Register the command in `cli/main.ts`, top-level usage, and completion/help
   surfaces. Export the supported review types and function from the deliberate
   SDK entry point (`sdk/mod.ts` or the repository's established public GitHub
   module) without exposing internal GraphQL response shapes.

8. Add deterministic tests for URL/number normalization, canonicalization and
   digest stability, contract validation, distinction between facts and agent
   judgment, warning/error mapping, incomplete GitHub signals, and rejection of
   mutation-capable execution. Add CLI tests for help, JSON shape, invalid
   input, credential/PR access failures, and read-only behavior using
   mocked/fake data rather than live GitHub or an installed agent. Add GraphQL
   mapping tests for head SHA, mergeability, checks, review decisions, and
   pagination/truncation.

9. Update `docs/README.md` and the relevant Denoise integration documentation
   with the command, JSON contract, cache identity semantics, configured agent
   behavior, required credentials, and the explicit read-only guarantee. Keep
   the documentation clear that a merge outlook is an evidence-based judgment,
   not a GitHub guarantee.

10. Run formatting, linting, type checking, and the relevant test suite through
    the repository's normal precommit/test tasks. Verify that the operation can
    run unattended with stdin closed and that no repository or GitHub state is
    changed during a successful or failed analysis.

## Acceptance Criteria

- [x] A caller can request a review brief for a specific repository and pull
      request URL or supported pull request number.
- [x] The result has a deterministic, documented versioned shape containing PR
      identity, canonical URL, head SHA, both review conclusions, supporting
      evidence/signals, warnings/limitations, and a canonical input
      representation or digest.
- [x] The brief clearly separates fetched facts from agent judgment and gives a
      qualified merge outlook using checks, mergeability/conflicts, draft
      status, approvals, requested changes, unresolved concerns, and branch
      state when available.
- [ ] The operation uses the configured agent/runtime and existing GitHub token
      resolution without introducing a separate credential model.
- [x] The operation is safe to invoke from Denoise as an on-demand read-only
      job: it does not write files, change branches, mutate PR metadata, create
      comments/reviews, publish commits, or alter CI state.
- [ ] Missing repository configuration, missing/unavailable credentials,
      inaccessible or missing PRs, incomplete GitHub data, unavailable diff
      context, and malformed/failed agent output produce explicit structured
      errors or warnings.
- [x] CLI help, machine-readable output, SDK exports, documentation, and
      completion support the operation.
- [ ] Unit and CLI tests cover canonicalization/digest determinism, GitHub
      mapping, contract validation, read-only safeguards, and the required
      failure cases; formatting, lint, typecheck, and tests pass.

## Code Pointers

### Files to Modify

- `cli/main.ts` (subcommand registration and usage): register `read` and expose
  its top-level help/completion behavior.
- `sdk/github/github-gql.ts` (PR query, response types, and
  `fetchPullRequestWithComments` area around lines 314-1288): fetch and map
  head/base identity, merge/check/review signals, source changes, and
  completeness metadata using read-only GraphQL queries.
- `sdk/github/types.ts` (shared GitHub exports): expose only supported review
  contract types if the public module uses this shared type surface.
- `sdk/mod.ts` (public SDK exports): export the review brief API and its
  documented types intentionally.
- `sdk/github/agentHarness.ts` and `sdk/config/localAgent.ts` (existing agent
  selection/runtime): reuse configured harness/model resolution and the
  read-only execution path rather than adding another configuration mechanism.
- `docs/README.md` (CLI/API overview): document `dn read` and its output.
- `docs/denoise-integration.md` (Denoise contracts): document consumption,
  digest-based caching/invalidation, warnings, and read-only guarantees.
- `cli/main_test.ts` and/or a new CLI read test file: verify registration, help,
  JSON output, and failure behavior.
- Existing `sdk/github/*_test.ts` or new focused tests: verify GraphQL mapping,
  canonical input/digest behavior, and contract validation.

### Files to Create

- `cli/read.ts`: parse read-specific arguments, invoke the SDK operation, and
  render JSON or concise human-readable output without mutation options.
- `sdk/github/reviewBrief.ts`: public review brief types, canonicalization,
  digesting, validation, evidence/warning mapping, and orchestration of the
  read-only analysis.
- `sdk/github/reviewBrief_test.ts`: deterministic contract, digest, validation,
  warning/error, and read-only orchestration tests.
- `cli/read_test.ts`: isolated CLI behavior tests using injected/mock sources.
- `kickstart/system.prompt.read.md`: read-only review instructions and the
  strict machine-readable agent result contract.

## Notes

- The existing `PullRequestData` is sufficient for comments and basic branch
  context but does not include the head SHA, mergeability, checks, approvals, or
  requested-change state required by this issue; extending or adding a dedicated
  query is necessary.
- GraphQL fields and permissions can vary by repository visibility and token
  scope. The implementation should preserve partial data with explicit warnings
  where the two conclusions remain possible, and return a structured error when
  required identity such as the head SHA cannot be established.
- The safest default is to require a full PR URL unless current-repository PR
  number resolution can be implemented using existing remote detection without
  weakening the explicit repository identity in the result.
- This plan assumes “read-only” includes avoiding checkout/branch changes and
  workspace writes, not merely avoiding GitHub mutations. Temporary analysis
  resources must therefore be isolated and cleaned up.
- No new dependency should be added. Use the existing GraphQL client, token
  resolver, agent harnesses, Deno standard APIs, and project test utilities.
