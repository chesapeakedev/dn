---
name: kickstart progress reporter
overview: "dn half of #335: versioned ProgressReporter (Null/Ndjson/Http), orchestrator step/phase events, and DN_DISPATCH_ID wiring from workflows exec."
todos:
  - id: progress-module
    content: Add sdk/github/progress.ts with ProgressReporter interface + NullReporter, NdjsonReporter, HttpReporter; export from sdk
    status: completed
  - id: env-contract
    content: Document + implement DN_DISPATCH_ID, DN_PROGRESS=ndjson|http, DN_PROGRESS_URL, DN_PROGRESS_TOKEN; default Null when unset
    status: completed
  - id: instrument-orchestrator
    content: Emit step.started/completed and phase.started/completed from kickstart/orchestrator.ts; publish.completed with pr_url/branch_name
    status: completed
  - id: replace-sandbox-stub
    content: Replace agentPhase.ts console.log stub with ProgressReporter.phase events when reporter active
    status: completed
  - id: workflow-exec-dispatch-id
    content: In cli/workflow/exec.ts, read dispatch_id from GITHUB_EVENT_PATH client_payload and export DN_DISPATCH_ID before spawning dn
    status: completed
  - id: docs
    content: Document env vars and event schema in docs/denoise-integration.md
    status: completed
  - id: unit-tests
    content: Unit tests for reporters (seq, schema_version) and orchestrator emit when DN_DISPATCH_ID set
    status: completed
  - id: precommit
    content: make precommit passes with zero errors
    status: completed
isProject: false
---

# Kickstart progress reporter (dn)

GitHub issue: [#335](https://github.com/chesapeakedev/chesapeake/issues/335)

Parent: [#151](https://github.com/chesapeakedev/chesapeake/issues/151) (closed).
Depends on denoise phase 1 SSE model: sibling plan in denoise repo
`plans/kickstart-progress-phase-1-sse.plan.md`.

Denoise ingest + phase UI: `plans/kickstart-progress-phase-2-ingest.plan.md` in
the denoise repo (same issue #335, other half).

## Why this matters

Without structured events, denoise can only show coarse GitHub Actions status.
`dn` already knows plan → implement → lint → publish; emitters here are the
stable contract for the UI.

## Current state

- Orchestrator prints human `[dn] Step N:` lines only
  (`kickstart/orchestrator.ts`)
- No `sdk/github/progress.ts`; no `ProgressReporter`
- Sandbox path logs `[progress] phase.started` via `console.log` in
  `sdk/sandbox/agentPhase.ts` (stub)
- `cli/workflow/exec.ts` does not set `DN_DISPATCH_ID` from
  `repository_dispatch` payload
- `dispatch_id` already travels in denoise `repository_dispatch` client_payload
  today

## Target state — event contract (`schema_version: "1.0"`)

```ts
interface KickstartProgressEvent {
  schema_version: "1.0";
  invocation_id: string; // === dispatch_id
  seq: number;
  ts: string; // ISO
  type:
    | "invocation.queued"
    | "invocation.running"
    | "step.started"
    | "step.completed"
    | "phase.started"
    | "phase.completed"
    | "lint.completed"
    | "publish.completed"
    | "invocation.succeeded"
    | "invocation.failed";
  phase?: "plan" | "implement" | "lint" | "publish";
  step?: number;
  message: string;
  data?: Record<string, unknown>;
}
```

Implementations:

1. **NullReporter** — default
2. **NdjsonReporter** — one JSON line per event on **stderr** when
   `DN_PROGRESS=ndjson` and `DN_DISPATCH_ID` set
3. **HttpReporter** — POST to `DN_PROGRESS_URL` with
   `Authorization: Bearer <DN_PROGRESS_TOKEN>`

Factory resolves from env so orchestrator always holds a reporter.

## Key files to change

| Path                                  | Role                                    |
| ------------------------------------- | --------------------------------------- |
| `sdk/github/progress.ts` (new)        | Reporter interface + implementations    |
| `sdk/mod.ts` or `sdk/github/` exports | Re-export                               |
| `kickstart/orchestrator.ts`           | Emit at step/phase/publish boundaries   |
| `sdk/sandbox/agentPhase.ts`           | Use reporter instead of console stub    |
| `cli/workflow/exec.ts`                | Set `DN_DISPATCH_ID` from event payload |
| `docs/denoise-integration.md`         | Env + event docs                        |

Match existing SDK style (see `sdk/github/publish.ts`, Apache headers).

## Out of scope (this plan)

- Denoise ingest endpoint / progress tokens (denoise #335 half)
- Agent stdout `agent.line` streaming (#336 —
  [kickstart-agent-streaming.plan.md](./kickstart-agent-streaming.plan.md))
- Local/cloud_vm runners (denoise #336)

## STOP conditions

- If denoise ingest URL/token semantics conflict with this schema: STOP and
  align both plans before shipping incompatible formats
- Do not log secrets in event `message`/`data`
- Do not buffer forever — HttpReporter should fail soft (log once) if network
  errors so kickstart still completes

## Verification

```bash
make precommit
# Manual: DN_DISPATCH_ID=test DN_PROGRESS=ndjson dn kickstart … 2>progress.ndjson
# Expect NDJSON lines with increasing seq and phase events
```
