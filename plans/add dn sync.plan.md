# dn sync

## Overview

Add a **`dn sync` CLI subcommand** that performs the Sapling-backed “sync with
trunk” workflow currently encoded in **`repo_sync.sh`**, aligned with the
**canonical narrative in `AGENTS.md`** (“Workflow: make sync”: lint gate,
pull/rebase onto `main`, optional **restack** for orphaned drafts, conditional
push). After implementation, **`make sync` should delegate to `dn sync`** so
users have one supported path (`dn`) instead of maintaining a standalone shell
script. The command should surface **clear, actionable failures** when `sl`
rejects (missing binary, conflicts, auth/credential failures) without masking
stderr.

## Issue Context

- **Issue**: #244
- **Title**: dn sync
- **Description (summary)**:
  - Introduce **`dn sync`** on the DN CLI (today users rely on
    **`repo_sync.sh`** / `make sync`).
  - **Push local draft commits to remote `main`** when appropriate after
    rebasing upstream.
  - **Authenticate / fail gracefully**: interpret and propagate errors from
    `make`/`sl`; give guidance where DN already does (e.g. docs links) rather
    than silently failing.
  - **Replace** the standalone **`repo_sync.sh`** pattern once `dn sync` ships.
  - Align with **`AGENTS.md` `make sync`**: lint before remote operations,
    **`sl pull --rebase -d main`**, **restack** when the graph needs it (see
    canonical script snippet in AGENTS.md), **`sl push --to main`** only when
    draft commits exist on the main stack lineage.
  - Issue text also mentions integrating with the **same GitHub-related patterns
    as `dn issue`**: DN’s GitHub OAuth/device flow (**`dn auth`**) affects
    **GitHub API** callers, not Sapling HTTPS push directly—**document this**
    and optionally **detect common push failures** to suggest **`gh auth`** /
    credential helper / SSH as appropriate (**assumption**: no new GitHub API
    calls are strictly required unless product wants a health check endpoint).
- **Labels**: dn

## Implementation Plan

### 1. Behaviour specification (parity + fixes)

Implement **ordered steps** (fail fast), matching **`AGENTS.md`** (not only the
shorter current `repo_sync.sh`):

1. **Lint gate** — equivalent to **`make lint`** (`fmt`, then
   **`deno task typecheck`** and **`deno task lint`** per `Makefile`). Run with
   **`cwd`** at the Sapling/repo root discovered for the session.
2. **`sl pull --rebase -d main`** — inherit exit code; on failure, preserve
   **`sl`** stderr/stdout messaging (conflicts / network / auth).
3. **Conditional `sl restack`** — when orphans exist:

   ```bash
   sl log --rev "children(obsolete()) - obsolete()" -T "{node}\n"
   ```

   If any revision is emitted, run **`sl restack`**. (**Note**: today’s
   `./repo_sync.sh` omits this; **`dn sync` should include it** to match
   **`AGENTS.md`**.)

4. **Conditional push** — if draft commits exist on the main-line stack (**same
   revset as `repo_sync.sh` / AGENTS**:

   ```
   draft() & ancestors(.) & descendants(main)
   ```

   then run **`sl push --to main`**. Otherwise skip push and print an
   informative message (nothing to publish).

Optional design choices (implementer decides; document in **Notes** if shipped):

- **`--cwd` / positional root** mirroring **`dn meld`**’s **`--workspace-root`**
  so invocation from subdirectories matches `sl root`.
- **`--dry-run`** / **`--skip-lint`** (dangerous)—only add if justified;
  defaults must match current `make sync` safety posture.

### 2. Implementation structure

1. **`cli/sync.ts`**
   - `handleSync(args: string[]): Promise<void>`
   - Parse `--help`; optional flags if any.
   - Resolve working directory (**default `Deno.cwd()`**, or explicit root).
     Confirm **`sl root`** resolves (Sapling repo); error with crisp message if
     not. Prefer **Sapling-first** wording consistent with **`AGENTS.md`**
     (avoid steering contributors to **`git`** in copy for this workflow).
2. **`Deno.Command` or `$dax`** (`$` from **`$dax`**) subprocess helpers—match
   existing style:
   - **`sdk/github/vcs.ts`** already uses **`$`** for **`sl`**;
     **`cli/release/api.ts`** uses **`Deno.Command`** for **`sl`**/ **`git`**.
   - Run **`make lint`** via shell or invoke **`make`** with **`["lint"]`**
     **`cwd`** at repo root (requires **`make`** on PATH—same assumption as
     **`repo_sync.sh`**).
   - Pipe **`sl log`** similarly to bash (non-interactive filters); parse first
     line nonempty ⇒ restack or push predicates.
3. **`cli/main.ts`**
   - Import **`handleSync`**; add **`case "sync":`** ; extend **`showUsage()`**
     banners and **`Subcommands`** help text.
4. **Replace `Makefile` sync target** so **`make sync`** runs **`dn sync`** (or
   **`deno run ... cli/main.ts sync`** during local dev—the exact pattern used
   elsewhere in **`Makefile`** for **`dn`** / **`compile`** installs). Preserve
   backward compatibility expectation: **`make sync` from repo root works**
   after **`make configure` / compile install**.
5. **`repo_sync.sh`**
   - Either **delete** after **`make sync` delegates to `dn`**, or leave a
     **one-line deprecation wrapper** invoking **`dn sync`** for transitional
     scripts (**assumption**: issue prefers elimination of standalone script
     logic—prefer deprecation stub or removal with changelog note).

### 3. Documentation

1. **`docs/subcommands.md`** — new **`dn sync`** section: purpose, prerequisites
   (**`sl`**, **`make`/`deno` tasks**, repo root), step summary, troubleshooting
   (conflicts, no drafts, credential errors).
2. **`AGENTS.md`** — update **`Workflow: make sync`** to say implementation is
   **`dn sync`** (`make sync` invokes it); fix stale **`hack/repo_sync.sh`**
   path reference to **`repo_sync.sh` / dn sync**.
3. **`CONTRIBUTING.md`** — optionally mention **`dn sync`** as alias of
   **`make sync`** once wired.

### 4. Verification

1. **`make precommit`** (or **`deno task precommit`**) passes after edits.
2. Manual smoke (**human**): in a Sapling checkout with drafts on **`main`**
   lineage vs clean state—confirm push vs skip; confirm restack pathway if
   reproducible orphan graph.
3. **Automated tests** (recommended but environment-dependent): **mock
   `sl`/`make` binaries** in **`$PATH`** temp dirs or **`DENO_TESTING`-style
   stubs** testing predicate parsing and ordering without a real Sapling
   remote—mirror patterns in **`cli/test_utils.ts`** / **`release`** tests only
   where viable; avoid nondeterministic real network.

### 5. Out of scope (unless issue expands)

- **Git-only** parity (issue + **`AGENTS.md`** emphasise Sapling)—do not broaden
  to **`git pull --rebase` / `git push`** unless a follow-up asks for dual-VCS
  **`dn sync`**.

## Acceptance Criteria

- [x] **`dn sync` is registered** in **`cli/main.ts`** with **`--help`** text
      consistent with other subcommands.
- [x] Workflow runs **lint (equivalent to `make lint`)** before any **`sl`**
      network/pull step.
- [x] Executes **`sl pull --rebase -d main`** and surfaces merge/rebase errors
      without swallowing **`sl`** output.
- [x] Implements **conditional `sl restack`** using revset
      **`children(obsolete()) - obsolete()`**, matching **`AGENTS.md`**.
- [x] Implements **conditional `sl push --to main`** only when
      **`draft() & ancestors(.) & descendants(main)`** yields commits; prints
      when push is skipped.
- [x] **`make sync`** is updated to invoke **`dn sync`** (or bundled **`dn`**
      entry) so **`repo_sync.sh` duplication is no longer authoritative.
- [x] **`docs/subcommands.md`** documents **`dn sync`**; **`AGENTS.md`** sync
      narrative references **`dn sync`** and correct script path/story.
- [x] Lint/typecheck (**`make precommit`**) passes; any new helpers are
      **typed** (**no `any`**).

## Code Pointers

### Files to Modify

- **`cli/main.ts`** — Switch branch, **`showUsage`** strings for **`sync`**
  subcommand wiring.
- **`Makefile`** — **`sync`** target currently runs **`./repo_sync.sh`**;
  reroute to **`dn sync`** (ensure **`dn`** on PATH vs **`deno run`**—match
  project convention from **`configure` / compile** flows).
- **`AGENTS.md`** — § **Workflow: `make sync`**: canonical steps +
  **`dn sync`**; correct outdated **`hack/repo_sync.sh`** reference.
- **`docs/subcommands.md`** — Reference section for **`dn sync`**.
- **`CONTRIBUTING.md`** (optional)—mention **`dn sync`** beside **`make sync`**.

### Files to Create

- **`cli/sync.ts`** — Subcommand handler: argument parsing, root resolution,
  ordered **`make`** / **`sl`** steps, stderr-forwarding/error messages.

### Files to Delete or Thin (after cutover)

- **`repo_sync.sh`** — Replace with deprecation stub invoking **`dn sync`** or
  remove if **`Makefile`**/`AGENTS`/docs fully migrate (**decision documented in
  Notes at implement time**).

### Related Patterns (read-only references)

- **`sdk/github/vcs.ts`** — **`sl root`** / Sapling ergonomics via **`$dax`**.
- **`repo_sync.sh`** — Current lint + pull + conditional push (missing
  **restack** vs AGENTS).
- **`cli/release/api.ts`** — **`Deno.Command("sl", ...)`** subprocess example.

## Notes

- **`repo_sync.sh` vs AGENTS snippet**: **`AGENTS.md` embeds** a fuller script
  (includes **restack**); **`./repo_sync.sh` in-repo today does not.**
  **`dn sync` should implement the AGENTS-complete behaviour** unless product
  explicitly prefers the thinner script—in which case reconcile docs.
- **GitHub OAuth (`dn auth`)**: primarily for **REST/GraphQL** in
  **`sdk/github/*`**; Sapling **`push`** uses **repository remote credentials**.
  “Same client” expectation is likely **consistent UX/documentation** rather
  than invoking **`octokit`** for sync—**assume** optional follow-up could add
  **`gh`/HTTPS** hints from stderr parsing.
- **Permissions**: spawned subprocesses require **`deno`** runtime
  **`--allow-run`** coverage for **`make`/`sl`** (CLI already **`--allow-all`**
  in shebang for **`cli/main.ts`**).
- **`make` portability**: **`make lint`** shells out to **`deno`**; Windows
  contributors are out-of-scope unless existing Make targets already support
  them.
