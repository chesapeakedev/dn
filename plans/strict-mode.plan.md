# strict mode in denoise

## Overview

Add a per-milestone strict-mode workflow to denoise. A milestone should be
configurable independently so teams can use ordinary planning for exploratory
work and opt into an automated, direct-to-trunk path for small, well-scoped
tasks. The milestone view should make the mode, queue state, runner ownership,
and kickstart progress visible to product managers and software engineers while
preventing duplicate or stale actions when several people use the view at once.

The current checkout is the `dn` CLI/integration repository, not the denoise web
application. No milestone-view frontend, denoise API, or denoise database schema
is present here. The primary implementation belongs in the denoise application;
this repository supplies the existing milestone stack, dispatch, publish, and
progress contracts that the application must use or extend.

## Issue Context

- Issue: #444
- Description: Add strict mode to the denoise milestone view.
- Labels: `dn`, `denoise`
- Relationships: No parent, sub-issues, blockers, or duplicate issue reported.
- Product intent: Let product managers and software engineers work side by side
  from milestone and repository views, with strict milestones optimized for
  small tasks that can be kickstarted in parallel and published directly when
  checks succeed.

## Implementation Plan

### 1. Define the milestone strict-mode contract

- Add a persisted, versioned milestone setting, for example
  `strict_mode: boolean`, with `false` as the default for existing milestones.
- Keep this setting on the milestone rather than as a global user or repository
  preference so teams can progressively introduce strict milestones.
- Define the state machine for a strict task: eligible, queued, claimed,
  planning, implementing, checking, publishing, succeeded, failed, and manually
  resolved.
- Define which transitions are server-authoritative and which are merely UI
  projections. A runner claim must be atomic and must expire or be explicitly
  released so stale browser state cannot start duplicate work.
- Specify permissions for changing the setting, editing tasks, starting a
  kickstart, resolving a failed task, and manually publishing a fix.

### 2. Extend milestone creation and editing UX

- Add the strict-mode toggle to the guided milestone creation flow and the
  existing milestone settings/edit surface.
- Explain the consequences before enabling it: successful kickstarts use direct
  publishing, CI/deployment becomes the acceptance gate, and failures require
  triage rather than silently remaining in a review-only queue.
- Show the effective mode prominently in the milestone header and task cards; do
  not require users to infer it from the selected runner or publish result.
- Preserve the setting when milestones are refreshed, reordered, or viewed from
  another device, and make the default behavior for old milestones explicitly
  non-strict.

### 3. Implement strict-mode task execution

- Route strict milestone kickstarts through the existing runner dispatch path,
  carrying the milestone and task identifiers plus a correlation/dispatch ID.
- At successful completion, select `publish=direct` for the strict workflow only
  after the implementation and configured checks pass. Do not let a client-side
  toggle bypass server-side validation of the milestone mode.
- Keep ordinary milestones on the existing review/PR behavior. The user must be
  able to run different modes concurrently across milestones.
- Ensure a task cannot be claimed twice across milestone view, repository view,
  scheduled execution, or a retry. The claim/lock response should include the
  current owner, invocation ID, timestamps, and a retry-safe status.
- Define failure behavior: retain logs and the failed state, allow an engineer
  to inspect/edit repository context, and support retrying or manually closing
  the task without marking an unsuccessful run as successful.

### 4. Build observability and collaboration UI

- Add live task and runner status to the milestone view using the existing
  progress event correlation model where available. The current `dn` contract
  supports phase/step events and terminal invocation events through
  `DN_DISPATCH_ID` and the progress endpoint.
- Display the latest status, phase, runner, started/updated times, publish
  result, and links to the relevant Actions run, PR, or direct-publish commit.
- Show a clear stale-data/reload state and reconcile updates from other users
  instead of overwriting local edits with an older snapshot.
- Add a milestone activity/history section for recent task runs and the latest
  successful and failed outcomes. Keep enough event identity to distinguish
  retries and concurrent tasks.
- Add an engineer-oriented repository-context surface or link that supports
  reviewing the failed kickstart, editing the relevant files, and rerunning the
  task without losing the milestone's history.

### 5. Align stack and workflow integration

- Use the generated milestone stack as the deterministic queue where that is the
  selected execution model. The existing artifact is
  `plans/{owner}_{repo}_{milestone}.stack.md` with a JSON companion and checked
  state; strict-mode UI actions must not mutate it optimistically without a
  correlated server/workflow result.
- Decide whether strict mode should dispatch `dn.daily_kickstart`,
  `dn.kickstart_issue`, or a new denoise-owned endpoint. If the current daily
  workflow is reused, add an explicit strict/direct-publish contract rather than
  relying on the scheduled workflow's current hard-coded `--publish pr`.
- If the `dn` contract changes, update the canonical workflow template, manifest
  payload schema and version/checksum, dispatch validation, workflow argument
  resolution, and documentation together. Canonical Actions currently rejects
  `publish=direct` for `dn.kickstart_issue` and `dn.init_stack`, so a strict
  direct-publish path cannot be implemented by changing only the UI.
- Preserve dispatch IDs and progress tokens end to end. Never expose the
  per-invocation progress bearer token in milestone history or logs.

### 6. Test and document the behavior

- Add API/database tests for default-off migration, per-milestone persistence,
  authorization, atomic claims, lock expiry/release, retry idempotency, and
  strict-mode state transitions.
- Add frontend tests for creation/edit toggling, mode-specific controls,
  concurrent updates, stale states, progress rendering, and failed-run triage.
- Add integration tests covering strict dispatch, direct publish only on
  success, failed checks, duplicate starts, and retry correlation.
- If `dn` contracts change, update tests near `sdk/workflows/dispatch.ts`,
  `cli/workflow/exec.ts`, and the workflow templates for payload validation,
  command mapping, progress propagation, and generated checksum validation.
- Update denoise user documentation with the mode's guarantees, permissions,
  failure/retry workflow, and recommended CI/CD protections. Update
  `docs/denoise-integration.md` and related `dn` docs only for any changed
  external contract.

## Acceptance Criteria

- [ ] A milestone can independently enable or disable strict mode, and existing
      milestones remain non-strict after migration.
- [ ] The milestone view clearly shows the effective mode and provides guided
      creation/edit controls with the required permissions.
- [ ] Strict-mode kickstarts are server-validated, claimable only once, and
      expose an unambiguous runner/invocation status across milestone and repo
      views.
- [ ] A successful strict kickstart publishes directly only after all required
      implementation and CI checks pass.
- [ ] Non-strict milestones retain their existing PR/review workflow and are not
      affected by strict-mode behavior.
- [ ] Failed strict kickstarts remain visible with actionable logs/context and
      can be triaged, retried safely, or manually resolved without false
      success.
- [ ] Progress, retries, publish results, and stale-data handling are covered by
      automated tests and are understandable in the milestone activity history.
- [ ] Dispatch IDs, runner ownership, and progress credentials are correlated
      securely without exposing bearer tokens to users or persisted activity
      logs.
- [ ] Any changed `dn` workflow payloads, templates, manifests, checksums,
      tests, and integration documentation are updated together and pass the
      repository's formatting, lint, type-check, and test gates.

## Code Pointers

### Files to Modify

- `docs/denoise-integration.md` (dispatch and progress sections): update the
  denoise-facing contract if strict direct publishing or milestone status events
  require new payload fields or event guarantees.
- `templates/workflows/dn-kickstart-issue.yml` and
  `templates/workflows/dn-daily-kickstart.yml`: modify only if strict mode is
  implemented through a canonical Actions workflow; make publish selection
  explicit and preserve the existing non-strict behavior.
- `templates/workflows/manifest.json`: version payload/schema metadata and
  regenerate checksums when workflow contracts change.
- `sdk/workflows/dispatch.ts` and `sdk/workflows/dispatch_test.ts`: validate any
  new strict-mode or direct-publish dispatch fields and maintain compatibility
  rules for existing callers.
- `cli/workflow/exec.ts` and `cli/workflow/exec_test.ts`: map the strict
  dispatch to the correct kickstart arguments, preserve correlation, and test
  duplicate and terminal-state behavior.
- `sdk/github/publish.ts`: extend publish-mode resolution only if the strict
  contract needs a distinct, typed policy; do not weaken the current canonical
  Actions restriction on direct publishing without an explicit security design.
- `sdk/github/stack.ts`, `cli/init-stack.ts`, and associated tests: update stack
  metadata or queue semantics if strict mode needs persisted milestone policy or
  server-reconciled task claims.
- `docs/github-actions.md`, `docs/subcommands.md`, and `docs/strict-mode.md`:
  document any changed automation semantics and distinguish repository `dn.json`
  strict policy from denoise milestone strict mode.

### Files to Create

- Denoise application migration/model, API, frontend, and test files for the
  persisted per-milestone strict setting, task claim state machine, activity
  feed, and milestone-view controls. Exact paths cannot be identified in this
  checkout because the denoise application is not present.
- `dn` integration tests or contract fixtures for any newly introduced strict
  milestone payload/event schema, if the contract is expanded.

## Notes

- The issue text combines a focused feature request with broader product ideas
  about real-time editing, repository-context curation, commit-stack views, and
  learning from failed kickstarts. The implementation should ship the smallest
  coherent slice first: per-milestone configuration, safe strict execution,
  progress visibility, and failure triage. Real-time collaborative markdown
  editing and recommendation systems should be separate follow-up work unless
  the denoise repository already has those primitives.
- `dn` already has a repository-level `strict.enabled` / `strict.require_rfcs`
  policy in `docs/strict-mode.md`. That policy guards planning against missing
  RFCs and is not the same feature as a denoise milestone's direct-publish
  execution mode; both names must remain explicitly distinguished in UI and API
  schemas.
- The current canonical hosted Actions workflow accepts only `publish=pr` for
  kickstart dispatches, while local CLI invocations support `direct`. Direct
  publishing from denoise therefore requires either a trusted device/exe.dev
  runner path already authorized for it or a deliberate, reviewed update to the
  hosted workflow contract and its permissions.
- Assumption: strict mode is opt-in and defaults off. Assumption: direct
  publishing means the runner updates the configured trunk, while repository
  branch protection and deployment checks remain the final safety boundary.
- Verification for this planning phase is limited to static repository
  inspection. Implementation should run `make precommit` in this checkout and
  the denoise application's full migration, API, frontend, and integration test
  suites after the owning repository is identified.
