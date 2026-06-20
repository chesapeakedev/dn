---
name: publish
description: Run the canonical dn release workflow. Use when the user asks to publish dn, release dn, bump the dn version, or ship a specific dn version. The repository release script owns versioning, validation, Sapling commit and sync, GitHub release creation, and release notes.
---

# Publish dn

Run the repository release target from a clean working copy:

```bash
make release
```

For an explicit version, run:

```bash
make release VERSION=<version>
```

Do not reproduce individual release steps. `scripts/release.ts` validates the
working copy, updates `deno.json`, runs precommit checks, commits and syncs with
Sapling, and creates the GitHub release. The GitHub release triggers the binary
release workflow.

If the command fails after creating the version commit, inspect `sl status` and
the GitHub release before retrying. Do not bump the version again to recover a
partially completed release.
