# AGENTS.md

This file provides instructions for agentic coding agents operating in this
repository. It documents how to work on this codebase in the same way a human
would.

## Project Overview

- Runtime: **Deno** (TypeScript-first)
- Build Output: `dn` CLI
- Entry point:
  - `cli/main.ts`: `dn` CLI
- Package management: native Deno ESM imports (`deno.json`, `jsr.json`)
- Lockfile: `deno.lock`

Agents should assume the following applications are available in the
environment. DO NOT INSTALL THESE DEPENDENCIES YOURSELF!!! THEY ARE FOR HUMANS
TO MANAGE >:(

- deno (version >=2.6.3)
- dn
- sl
- git
- cargo

dn is built from source in the repository. If you find that dn is not available,
ask users to try running `make configure`

## Reduce Blast Radius

Agents operating in this repository are expected to:

- Run lint and type checks (or reason about them) before finalizing changes.
- Respect existing architecture and domain boundaries.
- Prefer clarity and correctness over cleverness.
- Ask before large or cross-cutting architectural changes.

When in doubt, choose the simplest solution that fits existing code.

## Verifying Changes

Run `make precommit` to format the codebase, type check, and run linters. This
command should return 0 errors before you consider a task completed. `make fmt`
enforces formatting in the repo and can be run to fix up formatting quickly.

## JSR Package Quality

This repository is published on **jsr.io**. Agents should actively optimize
changes for a high JSR package score.

Guidelines aligned with https://jsr.io/docs/publishing-packages:

- Public API surface is explicit and intentional
  - Export only supported APIs from `sdk/index.ts` and other entrypoints
  - Avoid leaking internal types, helpers, or file paths
- Types are complete and accurate
  - All exported symbols must be fully typed
  - No `any`, no implicit `unknown`, no widening return types
  - Prefer precise literal unions and branded types where appropriate
- Documentation is first-class
  - Every exported function, class, and type has a TSDoc comment
  - Comments describe _behavior and guarantees_, not implementation
  - Examples are short, correct, and copy-pasteable
  - Public symbols without behavior-focused TSDoc should be treated as incomplete
- README and docs stay in sync
  - Public behavior changes require updating `docs/README.md`
  - New public APIs should be mentioned with a minimal example
- Stable module structure
  - Avoid breaking changes to exports without strong justification
  - Follow semantic versioning expectations when modifying public APIs
- Clean build and analysis
  - No unused exports
  - No dead code in published modules
  - Lint, type-check, and tests must pass before publishing

When making changes that affect the published surface, think like a package
consumer: discoverability, correctness, and clarity matter more than internal
convenience.

## Imports and Dependencies

- Use **Deno-style ESM imports only** (no CommonJS).
- Prefer JSR and Deno standard library over npm.
- Import aliases are defined in `deno.json` (e.g. `$std/`, `discord/`).

Guidelines:

- Prefer explicit imports over barrel files.
- Do not add new dependencies unless requested.
- Import order:
  1. Deno standard library from JSR
  2. JSR
  3. NPM

## TypeScript

- TypeScript is mandatory; `any` is NOT ALLOWED
- Use `interface` for extendable object shapes.
- Use `type` for unions and composition.
- Prefer type guards over casts.
- Avoid non-null assertions unless proven and commented.

### Naming Conventions

- Files: `camelCase.ts`
- Functions and variables: `camelCase`
- Classes and interfaces: `PascalCase`
- Constants: `SCREAMING_SNAKE_CASE` (true constants only)

Names should be:

- Descriptive
- Domain-oriented
- Free of abbreviations unless universally understood

Avoid one-letter variable names outside of very small scopes.

## Project Structure

_maintain parity with README.md_

- **`cli/`** - CLI entry point, subcommand implementations (kickstart, prep,
  loop, meld, archive)
  - `kickstart.ts` - Entry point for kickstart CLI workflows
  - `prep.ts` - Workspace and repository preparation logic
  - `loop.ts` - Iterative execution and refinement workflows
- **`docs/`** - Supplemental documentation for `dn` users & contributors & LLM's
  - `README.md` - User-facing overview and CLI usage
  - `CONTRIBUTING.md` - Contribution and workflow guidelines
  - `AGENTS.md` - Agent behavior and coding conventions
- **`glance/`** - Project velocity and reporting tools
  - `main.ts` - Glance CLI entry point
  - `collect.ts` - Data collection and aggregation
  - `render.ts` - Visualization and report generation
- **`kickstart/`** - End-to-end GitHub issue workflows
  - `lib.ts` - Public APIs for plan and loop phases
  - `orchestrator.ts` - Full workflow coordination and state transitions
  - `artifacts.ts` - Generated artifacts (plans, prompts, reports)
- **`sdk/`** - Public APIs for the dn project
  - `index.ts` - Primary SDK export surface
  - `client.ts` - Programmatic interface to dn workflows
  - `types.ts` - Shared public types and contracts

## Error Handling

- Fail fast on programmer errors.
- Gracefully handle external failures (network, I/O).

Guidelines:

- Throw `Error` objects with context.
- Never swallow errors.
- Log errors only at boundaries (CLI entrypoints, Discord handlers).

Avoid broad `catch` blocks that hide root causes.

## Async and Concurrency

- Prefer `async`/`await`.
- Always `await` unless explicitly fire-and-forget.
- Consider when `Promise.all` and other `Promise` functions can be utilized to
  improve performance

## Testing Guidelines

- Tests must be deterministic and isolated.
- Prefer testing pure logic (filters, utils, SDK pieces).
- Place tests alongside behavior when reasonable, or at repo root if global.

When adding tests:

- Use clear, descriptive test names.
- Test behavior, not implementation details.

Do not add snapshot tests unless explicitly requested.

## Using dn

Use `dn` when interacting with Github & local plan files. `dn` provides useful
workflows for vibe coders as subcommands. Run `dn` to see subcommands and
consider how they can make your tasks easier or more straightforward. Read
`docs/subcommands.md` for detailed information on subcommands

### Examples

FIXME: add examples so this section is a few shot prompt for the models
