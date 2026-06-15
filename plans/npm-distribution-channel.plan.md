# npm Distribution Channel — Skill + CLI in One Shot

## Overview

Close the third side of the distribution triangle. Currently a user can get the
dn skill from the CLI (`dn init agents --skill`) or get the CLI from an install
script (`scripts/install.sh`). There is no zero-prerequisite path that delivers
**both** skill files and the `dn` binary in a single, discoverable command.

Publish an npm package (`@chesapeake/dn-skills`) that users run via `npx`. This
pattern mirrors the most widely adopted approach in the ecosystem — used by
`@agentrules/cli`, `cursor-handbook`, `agent-install`, `@usrrname/cursorrules`,
`@djm204/agent-skills`, and `coding-agent-fabric` — and requires no
pre-installed runtime beyond `npx` (shipped with Node.js, present on virtually
every dev machine).

### The three paths, complete

| Path                  | Command                                        | Prerequisites |
| --------------------- | ---------------------------------------------- | ------------- |
| CLI → Skill           | `dn init agents --skill --agent all`           | `dn` on PATH  |
| Script → CLI          | `curl -fsSL https://dn.dev/install.sh \| bash` | curl/sh       |
| Channel → Skill + CLI | `npx @chesapeake/dn-skills init`               | npx (Node.js) |

## Issue Context

- No tracking issue yet; this is a greenfield distribution effort.
- Motivations: meet users in their existing workflows (npm is the de facto
  package registry for dev tooling), single-shot onboarding, discoverability via
  `npm search` and package registries.

## Design Constraints

1. **Skill content is authoritative in the dn repo.** The `DN_SKILL_CONTENT`,
   `OPENAI_METADATA_CONTENT`, and `CURSOR_RULE_CONTENT` templates live in
   `cli/init-agents.ts`. The npm package should not be a second source of truth.
2. **The npm package is a thin orchestrator.** It delegates to `dn` when
   available, and falls back to embedded/verified skill content when not.
3. **`--agent all` support** (being implemented by another agent) is the target
   for the npm package. The npx command should install skills for all supported
   agents by default.
4. **CLI install is optional.** Users should be able to get just the skill files
   (`npx @chesapeake/dn-skills init`) or also install the binary
   (`--install-dn`).
5. **Idempotent.** Re-running is safe; managed files are tracked, existing
   unmanaged files are left alone (same semantics as `dn init agents --skill`).

## Implementation Plan

### Phase 1 — Scaffold the npm package

1. Create `package.json` at repo root with:
   - `name: "@chesapeake/dn-skills"`
   - `bin: { "dn-skills": "./dist/cli.mjs" }`
   - `files: ["dist/", "skills/"]`
   - `type: "module"`
   - Version pinned to match `deno.json` (or independently versioned)

2. Create entry point `dist/cli.mjs` (or write in TypeScript and compile):
   - Parse subcommands: `init` (default), `help`
   - `init` subcommand:
     - Auto-detect agent harness from environment (`CURSOR_ENABLED`,
       `CLAUDE_ENABLED`, `CODEX_ENABLED`, `OPENCODE_ENABLED`) or accept
       `--agent` flag (default `all`)
     - If `dn` is on `PATH`: delegate to `dn init agents --skill --agent all`
     - If `--install-dn` is set: download `dn` binary from GitHub Releases,
       place in `~/.local/bin/dn`, then delegate
     - Otherwise: embed skill content and write files directly

3. Create a `skills/` directory with canonical skill files (mirroring what
   `cli/init-agents.ts` generates) as the embedded fallback source. These are
   copies verified against the repo on publish.

### Phase 2 — Implement `init` subcommand logic

4. **Skill installation logic** (standalone path, no `dn`):
   - Implement `installSkills(targetDir, agent)` that writes:
     - `.agents/skills/dn/SKILL.md` + `.agents/skills/dn/agents/openai.yaml`
       (for codex/opencode)
     - `.claude/skills/dn/SKILL.md` (for claude)
     - `.cursor/rules/dn.mdc` (for cursor)
   - Apply the same managed-marker pattern (`<!-- Managed by dn-skills -->`)
   - Implement `--dry-run`, `--json`, `--force` flags (parity with
     `dn init
     agents --skill`)

5. **CLI install logic** (`--install-dn`):
   - Download the appropriate asset from GitHub Releases using the same OS/arch
     detection as `scripts/install.sh`
   - Place binary in `~/.local/bin/dn` (or `--install-dir`)
   - Verify checksum from `checksums.txt` (best-effort)
   - Print PATH instructions if `~/.local/bin` is not on PATH

6. **Delegation logic** (when `dn` is on PATH):
   - Run `dn init agents --skill --agent all --json`
   - Parse JSON output and print human-friendly report
   - Pass through `--dry-run`, `--force`

### Phase 3 — CI integration

7. Add to the release workflow:
   - On version tag, build the npm package and publish with `npm publish` (or
     use `jsr publish` with npm compatibility)
   - Verify `skills/` directory is in sync with `cli/init-agents.ts` (add a CI
     check that compares the generated content)
   - Publish checksums for the package alongside GitHub release

### Phase 4 — Documentation

8. Update `README.md`:
   - Add the three-path table under a "Distribution" or "Installation" section
   - Show `npx @chesapeake/dn-skills init` as a one-shot command
   - Show `npx @chesapeake/dn-skills init --install-dn` for the full bundle

9. Update `docs/subcommands.md`:
   - Add `dn-skills init` to the table of workflows (or add a separate
     "Distribution channels" doc)

10. Add `docs/distribution.md`:
    - Describe the three distribution paths
    - When to use each one
    - Maintenance expectations for the npm package

### Phase 5 — Agent harness auto-detection

11. Detect the user's agent harness without a flag:
    - Check `CURSOR_ENABLED`, `CLAUDE_ENABLED`, `CODEX_ENABLED`,
      `OPENCODE_ENABLED` env vars
    - Check for Cursor IDE running (`CURSOR_TRACE` / `CURSOR_REMOTE`)
    - Check for Claude Code running (`CLAUDE_CODE` / `ANTHROPIC_API_KEY`)
    - Fall back to `--agent all` if no signal detected
    - Respect explicit `--agent` flag as override

## Acceptance Criteria

- [ ] `npx @chesapeake/dn-skills init` installs skill files for all supported
      agents in the project directory
- [ ] `npx @chesapeake/dn-skills init --install-dn` also installs the `dn`
      binary and places skill files
- [ ] `npx @chesapeake/dn-skills init --agent cursor` installs only cursor skill
      files
- [ ] When `dn` is already on PATH, the npm command delegates to
      `dn init
      agents --skill --agent all` instead of using its own
      fallback
- [ ] `--dry-run` prints planned writes without changing files
- [ ] `--json` outputs machine-readable result
- [ ] Managed files are idempotent; existing unmanaged files cause a conflict
      error unless `--force` is passed
- [ ] CLI install respects `--install-dir`, verifies checksums, prints PATH
      instructions
- [ ] CI publishes the npm package on every version tag
- [ ] CI check ensures `skills/` content matches `cli/init-agents.ts` templates
- [ ] README documents all three distribution paths
- [ ] `make precommit` passes after any code changes

## Code Pointers

### Files to create

- `package.json` — npm package manifest for `@chesapeake/dn-skills`
- `dist/cli.mjs` — CLI entry point (handles `init` subcommand)
- `skills/dn/SKILL.md` — Canonical skill content (fallback source)
- `skills/dn/agents/openai.yaml` — Codex/OpenCode metadata fallback
- `skills/dn/cursor.mdc` — Cursor rule fallback
- `docs/distribution.md` — Distribution channel documentation

### Files to modify

- `README.md` — Add npm distribution path and three-path table
- `docs/subcommands.md` — Reference npm distribution channel
- `scripts/release.ts` or equivalent CI workflow — Add npm publish step
- `.github/workflows/*.yml` — Add CI check for skill content sync

### Files for reference

- `cli/init-agents.ts` — Canonical skill content templates, managed marker
  pattern, install target paths
- `scripts/install.sh` — OS/arch detection, binary download, checksum
  verification logic to replicate
- `deno.json` — Existing package name/version convention
- `cli/test_init_agents.ts` — Existing tests for skill install behavior

## Notes

- **npm vs JSR:** npm is the right registry for this package because `npx` is
  the install mechanism and npm has widest reach. The existing JSR package
  (`@chesapeake/dn`) remains the SDK/CLI distribution target.
- **Versioning:** Consider independent versioning for the npm package (e.g.,
  `0.1.0` rather than tracking the deno.json version) to avoid unnecessary bumps
  when only CLI internals change. Or use a `version` file checked during CI.
- **The delegation pattern** (try `dn` first, fall back to embedded) means the
  npm package is robust to drift: when `dn` is available, the latest canonical
  behavior is used; when it's not, the embedded copy (verified at publish time)
  is used.
- **Dual-publish risk:** If this succeeds, keep the npm package minimal. It
  should never grow to become a second CLI — it is purely a thin distribution
  shim. Future complexity belongs in `dn` itself.
