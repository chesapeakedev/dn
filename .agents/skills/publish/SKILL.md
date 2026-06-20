---
name: publish
description: Release a new dn version by updating deno.json, validating the repository, committing the version change with Sapling, and pushing it to main. Use when the user asks to publish dn, release dn, bump the dn version, or ship a specific dn version. This skill does not create GitHub releases, tags, binaries, or JSR packages.
---

# Publish dn

Treat a dn release as a version bump committed and pushed to `main`. Leave
GitHub releases, tags, binary builds, and JSR publication to their separate
workflows.

## Release workflow

1. Run `sl status` and stop if the working copy contains unrelated changes.
2. Read the current version from `deno.json`.
3. Use the user's exact semantic version when supplied; otherwise use the next
   patch version.
4. Run `make release VERSION=<version>` from the repository root.
5. Verify that `deno.json` contains the requested version, `sl status` is clean,
   and `remote/main` points to the release commit.
6. Report the released version and pushed commit.

The release command runs `make precommit`, commits only `deno.json`, and runs
`make sync`. Do not separately call `deno publish`, `dn release create`,
`gh
release create`, or the GitHub release workflow.

## GitHub Actions boundary

`.github/workflows/release.yml` owns compiled binaries and checksums. A
published GitHub release causes the workflow to attach binaries. A manual
`workflow_dispatch` with a tag can create the GitHub release when absent and
attach binaries. Neither path is part of this skill.

## Failure handling

- If validation fails, leave the error visible and do not push.
- If pull or push is blocked by sandbox networking, retry the same Sapling
  command with network approval.
- If the version commit exists locally but push fails, resume with `make sync`;
  do not create another version commit.
