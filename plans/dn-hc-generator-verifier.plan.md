---
name: dn hc generator verifier
overview: "Implement dn hc (#343): generator/verifier loop pattern with gambits (intervals, shared sandbox, secrets) for goal-driven agent pairs."
todos:
  - id: design-model
    content: Define gambit config schema (generator prompt/script, verifier done-check, intervals, sandbox, metadata/secrets); support array of gambits
    status: completed
  - id: cli-surface
    content: Add dn hc subcommand (help, validate config, run one gambit / array sequentially)
    status: completed
  - id: generator-loop
    content: Run generator agent on interval until verifier reports done or timeout/max iterations
    status: completed
  - id: verifier
    content: Run verifier agent (or script) with shared workspace; distinct schedule from generator
    status: completed
  - id: ci-tail-gambit
    content: Support one-shot trailing gambit (e.g. CI fixer) that is not a loop
    status: completed
  - id: sandbox-reuse
    content: Reuse SandboxRunner lifecycle from sdk/sandbox for shared sandbox config when provider set
    status: completed
  - id: docs-tests
    content: Document in docs/subcommands.md; add unit/integration tests; make precommit green
    status: completed
isProject: false
---

# dn hc — generator / verifier loop

GitHub issue: [#343](https://github.com/chesapeakedev/chesapeake/issues/343)

Labels: `dn`, `sigma`. No prior implementation in this repo (greenfield).

## Why this matters

Kickstart is issue-shaped. Power users need a goal-shaped loop: one agent works
toward a system prompt/script; another verifies “done”; a gambit ties schedules,
sandbox, and secrets. Optional gambit arrays let a feature loop hand off to a
CI-fixer one-shot.

## Current state

- No `hc` subcommand in `cli/`
- Closest cousins: `dn loop` (implement-only on a plan), `dn kickstart`, sandbox
  lifecycle in `sdk/sandbox/`
- Agent harness dispatch: `sdk/github/agentHarness.ts`

## Target state

**Gambit** (conceptual):

- Generator: system prompt or script that advances the goal
- Verifier: decides whether generator is done (prompt or script; exit code /
  JSON verdict)
- Two intervals (or cron-like), shared sandbox config, metadata + secrets (env
  pass-through only — never write secrets into committed config)
- Optional **array** of gambits: e.g. (1) feature generator/verifier loop, (2)
  one-shot CI verifier

**CLI sketch** (adjust to match dn flag conventions during implementation):

```
dn hc validate <gambit.json>
dn hc run <gambit.json>
dn hc run <gambit.json> --once   # single generator+verifier tick
```

Prefer config file under repo (e.g. `.github/dn/gambit.json` or
`plans/*.gambit.json`) rather than huge CLI flags.

Reuse patterns from:

- `cli/loop.ts` / `kickstart/lib.ts` `runLoopPhase` for iteration
- `sdk/sandbox/lifecycle.ts` for isolation
- Existing agent harnesses for LLM calls

## Out of scope

- Denoise UI for gambits
- Billing / metering
- Replacing kickstart

## STOP conditions

- If verifier cannot be made deterministic enough for CI: ship local-dev `dn hc`
  first and document CI as experimental
- Do not block forever without max iterations / wall-clock timeout
- Do not store secrets in gambit JSON files

## Verification

```bash
make precommit
deno test cli/test_hc.ts --allow-all   # once added
# Manual: dn hc run fixtures/… --once
```
