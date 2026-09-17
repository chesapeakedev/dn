# dn tidy agent: multi-harness polish beyond opencode

## Overview

## Summary

Extend `dn tidy agent` beyond OpenCode with concrete cheap checks for cursor /
claude / codex / copilot. Deferred from #440 (v1: OpenCode complete + light
stubs/hints for others).

## Context

Parent: https://github.com/chesapeakedev/chesapeake/issues/440

## Goal

Per-harness programmatic checks without duplicating `dn init agents`:

- cursor: `.cursor/` / kickstart rule presence hints
- claude: `CLAUDE.md` / skills path hints
- codex: `AGENTS.md` presence (point at `dn init agents` / `dn context check`)
- copilot: config/secret hint only
- Keep `--check` / `--fix`, no LLM

## Non-goals

- Do not replace or reimplement full `dn init agents` / `dn workflows install`
- Do not absorb `make lint`

## Pointers

- `cli/tidy.ts`, `sdk/github/agentHarness.ts`, `cli/init-agents.ts`,
  `sdk/workflows/agentConfig.ts`

## Implementation Plan

1. Read the Overview and any linked paths or snippets.
2. Implement the described behavior in the smallest coherent change set.
3. Cover the Acceptance Criteria below.
4. Run the repository's lint and typecheck before finishing.

## Acceptance Criteria

- [ ] Implement the changes described in the Overview
- [ ] Add or update tests covering the change
- [ ] Project lint / typecheck passes
