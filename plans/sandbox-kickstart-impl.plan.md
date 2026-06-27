# Sandbox Phase 2: Kickstart/Loop Orchestrator Runs Inside Sandbox

## Overview

Route agent harness execution (plan, implement phases) through
`SandboxRunner.exec()` instead of running on the host. The host `dn` retains
orchestration, progress reporting, VCS publish, and teardown. Workspace sync
(in/out) handles bind-mount for Docker and git-clone for exe.dev.

## Issue Context

- Issue: #339
- Parent: chesapeake#195
- Description: Run kickstart and loop agent phases inside the configured sandbox
  (docker or exe.dev), with workspace sync in/out and VCS publish from the host.
- Depends on: sandbox phase 1 (config schema + `SandboxRunner` drivers)
- Labels: dn, denoise

## Implementation Plan

### Step 1: Add `syncIn()` to `SandboxRunner` interface + `SandboxExecContext` holder

**`sdk/sandbox/types.ts`:**

- Add `syncIn(handle: SandboxHandle): Promise<void>` to the `SandboxRunner`
  interface
- Export `SandboxExecContext` type:
  `{ runner: SandboxRunner; handle: SandboxHandle; provider: SandboxProvider }`

**`sdk/sandbox/hostRunner.ts`:**

- Add no-op `syncIn()` (already on host, nothing to sync)

**`sdk/sandbox/dockerRunner.ts`:**

- Add no-op `syncIn()` (bind mount at provision time keeps workspace in sync)

**`sdk/sandbox/exeDevRunner.ts`:**

- Implement `syncIn()`: push host workspace to a temp branch on `origin`, then
  have the VM clone/pull that branch via SSH
- Implement `syncOut()`: have the VM push changes back, then pull on host, then
  delete the temp branch
- Respect `sync.exclude` patterns during sync

### Step 2: Create sandbox context holder module

**`sdk/sandbox/context.ts` (new):**

- Module-level mutable holder for current sandbox context
- `setCurrentSandboxContext(ctx: SandboxExecContext | null): void`
- `getCurrentSandboxContext(): SandboxExecContext | null`
- `isSandboxActive(): boolean` — returns `true` when provider !== "none"

### Step 3: Update `runWithSandboxLifecycle` to call syncIn and set context

**`sdk/sandbox/lifecycle.ts`:**

- After `provision()`, call `runner.syncIn(handle)` to push workspace into
  sandbox
- Before `fn()`, set sandbox context via `setCurrentSandboxContext()`
- In the `finally` block, clear context after syncOut/teardown
- Change comment to reflect phase 2 is active

### Step 4: Route agent phases through sandbox in `kickstart/orchestrator.ts`

**`kickstart/orchestrator.ts`:**

- Import `getCurrentSandboxContext`, `isSandboxActive` from sandbox context
- Import `SandboxRunner`, `SandboxHandle`, `ExecResult` types

Extract a shared helper:

- `runAgentPhaseInSandbox(phase: "plan" | "implement", combinedPromptPath: string, workspaceRoot: string, useReadonlyConfig: boolean): Promise<ExecResult>`
  - Reads current sandbox context
  - If no sandbox active, falls back to `getRunAgent()`
  - If sandbox active:
    - Resolves the command to run: the agent harness command (e.g.,
      `opencode run plan` or `dn kickstart --sandbox none --phase plan`)
    - Sets `DN_SANDBOX_PROVIDER=none` and `DN_IN_SANDBOX=1` env vars for inner
      run
    - Calls `runner.exec(handle, [command, ...args])`
    - For Docker: ensure combined prompt paths are inside the bind-mounted
      workspace (not system /tmp)
    - For exe.dev: combined prompt must be inside workspace (which gets
      git-cloned)
  - Returns `ExecResult`

Change plan phase (line ~799):

- Replace `getRunAgent()` + `runPlan()` with the shared helper

Change implement phase (line ~888):

- Replace `getRunAgent()` + `runImplement()` with the shared helper

Change merge phase (line ~532):

- Replace `getRunAgent()` + `runMerge()` with the shared helper

**Workspace-relative temp dirs:**

- When sandbox is active, create temp dirs inside `WORKSPACE_ROOT/.dn/tmp/`
  instead of system `/tmp/` so Docker containers (bind-mounted to workspace) can
  see combined prompts
- Expose a `getWorkspaceTmpDir(workspaceRoot: string): string` helper in
  `sdk/sandbox/context.ts`

### Step 5: Route agent phases through sandbox in `kickstart/lib.ts`

**`kickstart/lib.ts`:**

- Import `getCurrentSandboxContext`, `isSandboxActive`
- In `runMeldPhase()` (line ~1069): route the plan phase call through the
  sandbox helper
- In `runLoopPhase()` (line ~1252): route the implement phase call through the
  sandbox helper
- In `fillEmptyIssueSections()` (line ~1795): route the LLM call through the
  sandbox helper

Same approach: if sandbox active, run the phase inside sandbox; otherwise use
`getRunAgent()` as before.

### Step 6: Update `sdk/sandbox/mod.ts` exports

Export new types and functions:

- `SandboxExecContext`
- `setCurrentSandboxContext`, `getCurrentSandboxContext`, `isSandboxActive`
- `getWorkspaceTmpDir`

### Step 7: Lint inside sandbox (preferred) or on host

- After implement phase and syncOut, run lint inside sandbox via `runner.exec()`
  and capture result
- If sandbox is not active, run lint on host as before
- Lint failures should warn but not block (same as current behavior)

### Step 8: Progress events

- Emit `step.started` and `phase.started` progress events from orchestration
  callsites
- Align with chesapeake#335/336 when the event schema is available; for now,
  just console.log with a structured prefix

### Step 9: Teardown hardening

- `sdk/sandbox/lifecycle.ts`: already wraps teardown in `finally` block — verify
  it catches all exit paths (including `Deno.exit()` if possible via signal
  handlers, and unhandled rejections)

### Step 10: Docker image definition

- Create `docker/Dockerfile` with minimal runtime image:
  - Install deno
  - Install opencode (or just dn from workspace build)
  - Set `WORKSPACE_ROOT` default
  - Set entrypoint to sleep (container runs detached)
- Publish to GHCR as follow-up; manual build initially

### Step 11: Documentation

**`docs/sandbox.md`:**

- Document end-to-end sandbox kickstart flow
- CLI examples: `dn kickstart --sandbox docker <issue>`,
  `dn kickstart --sandbox exe.dev <issue>`
- Docker image requirements
- Behavior in CI (GHA: sandbox defaults to none)
- exe.dev token setup (`EXE_TOKEN`)

## Acceptance Criteria

- [ ] `dn kickstart --sandbox docker <issue>` completes plan + implement inside
      container; changes appear in host workspace
- [ ] `dn kickstart --sandbox exe.dev <issue>` provisions VM, runs kickstart,
      tears down VM
- [ ] `dn loop --sandbox docker <plan>` works for implement phase inside sandbox
- [ ] `dn loop --sandbox exe.dev <plan>` works for implement phase
- [x] Sandbox teardown runs on failure (no orphaned VMs/containers) — already
      handled by finally block in lifecycle.ts
- [x] `--publish pr` still opens PR from host after sync-out — VCS publish logic
      is unchanged and runs on host
- [x] Combined prompt files are created workspace-relative when sandbox is
      active so they're visible inside the container/VM
- [x] `DN_SANDBOX_PROVIDER=none` is set for inner runs to prevent recursion
- [ ] `sync.exclude` patterns are respected for workspace sync
- [ ] Integration test with docker (skipped in CI without docker)
- [x] Docs: end-to-end sandbox kickstart guide in `docs/sandbox.md`
- [x] `make precommit` passes with zero errors

## Code Pointers

### Files to Modify

- `sdk/sandbox/types.ts` (lines 107-121): Add `syncIn()` to `SandboxRunner`
  interface, add `SandboxExecContext` type
- `sdk/sandbox/hostRunner.ts` (line 42): Add no-op `syncIn()`
- `sdk/sandbox/dockerRunner.ts` (line 122): Add no-op `syncIn()`
- `sdk/sandbox/exeDevRunner.ts` (lines 142-144): Implement `syncIn()` and
  `syncOut()` for `git_clone` mode
- `sdk/sandbox/lifecycle.ts` (lines 15-48): Add `syncIn()` call, set sandbox
  context, update signature
- `sdk/sandbox/mod.ts` (lines 1-62): Export new types and functions
- `kickstart/orchestrator.ts` (lines 532, 799, 888): Route agent phases through
  sandbox exec
- `kickstart/lib.ts` (lines 1069, 1252, 1795): Route meld/loop/prep phases
  through sandbox exec
- `docs/sandbox.md`: Document phase 2 features

### Files to Create

- `sdk/sandbox/context.ts`: Module-level sandbox context holder
  (`setCurrentSandboxContext`, `getCurrentSandboxContext`, `isSandboxActive`,
  `getWorkspaceTmpDir`)
- `docker/Dockerfile`: Minimal dn-kickstart container image

## Notes

- **Nested vs direct execution**: Plan prefers the "simpler v1" approach of
  running the agent harness command directly inside sandbox (e.g.,
  `opencode run plan`). Migrate to nested
  `dn kickstart --sandbox none --phase plan` once sandbox-aware phase flags are
  available.
- **Temp directory strategy**: Combined prompt files created by orchestrator
  must live inside the workspace (not `/tmp`) when a sandbox is active, since
  Docker containers bind-mount the workspace and exe.dev VMs clone the repo. A
  `.dn/tmp/` directory inside the workspace solves this.
- **exe.dev syncIn**: For `git_clone` mode, the host must push any dirty state
  to a temp branch before syncIn, then the VM clones/pulls that branch. This
  requires the repo to have a remote configured (which is typical for kickstart
  workflows).
- **exe.dev syncOut**: After agent phases complete, the VM pushes changes to the
  same temp branch, and the host pulls + deletes the temp branch.
- **Docker bind mode**: No explicit syncIn/syncOut needed since the workspace
  directory is bind-mounted at container start. Agent harness writes to
  `/workspace` which is immediately visible on the host.
- **GHA CI**: Sandbox defaults to `none` in CI since GHA runners are already
  ephemeral. Docker sandbox in CI is optional (advanced).
- **Lint**: Run inside sandbox via `runner.exec()` after syncOut; fall back to
  host if sandbox is not active.
- **Blocking errors**: The existing `detectBlockingError()` logic works on
  stdout/stderr from `ExecResult`, so it applies regardless of where the agent
  runs.
