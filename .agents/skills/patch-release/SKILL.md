---
name: patch-release
description: Repair an already-published dn GitHub release after its source commit or binary assets need correction. Use when asked to patch, repair, rebuild, replace, or republish binaries for an existing dn version without bumping that version.
---

# Patch an existing dn release

Use this workflow only for an existing release. For a new version, use the
`publish` skill and `make release`.

## 1. Audit before changing remote state

1. Read `AGENTS.md` and use Sapling, never Git.
2. Confirm the requested tag exists and matches the version in `deno.json`.
3. Inspect the release, tag ref, recent release workflow runs, and assets:

   ```bash
   gh release view <tag> --repo chesapeakedev/dn
   gh api repos/chesapeakedev/dn/git/ref/tags/<tag>
   gh run list --repo chesapeakedev/dn --workflow release.yml --limit 10
   ```

4. Read `.github/workflows/release.yml`. Confirm that `workflow_dispatch`
   accepts `tag`, builds the expected platform matrix, and replaces assets with
   stable names.
5. Run `deno task workflows:checksums --check`. Treat workflow manifest
   checksums as source integrity metadata, distinct from the release asset
   `checksums.txt`. This command also requires every manifest workflow to be
   embedded by `compile_dn.sh`. Resolve stale checksums, incomplete manifests,
   and missing binary includes before changing remote state.
6. Preserve unrelated working-copy changes. Do not delete or recreate the
   release.

## 2. Land the corrected source

1. Make the requested source and release-note corrections.
2. If any `templates/workflows/*.yml` file changed, run:

   ```bash
   deno task workflows:checksums --write
   deno task workflows:checksums --check
   ```

   Inspect the manifest diff and include only checksum changes corresponding to
   intentional template edits. Never hand-edit or guess checksum values.
3. Run `make precommit`. It must independently repeat the checksum check.
4. Build a temporary binary with `compile_dn.sh`, run
   `dn init workflows --agent opencode` from an empty temporary repository, and
   confirm every manifest workflow installs. Treat a missing embedded template
   or partial installation as blocking.
5. Commit all in-scope files with `sl commit`.
6. Run `make sync` to rebase and publish the commit to `main`.
7. Rerun `make precommit` after the rebase. If it changes files or fails, do not
   move the release tag.
8. Record the full landed commit:

   ```bash
   sl log -r . -T '{node}\n'
   ```

9. Verify GitHub's `main` ref resolves to that exact commit before moving the
   release tag.

## 3. Retarget and rebuild

Update the existing lightweight tag to the corrected commit:

```bash
gh api --method PATCH \
  repos/chesapeakedev/dn/git/refs/tags/<tag> \
  -f sha=<full-landed-commit> \
  -F force=true
```

Patch the existing release notes in place when they describe superseded
behavior. Preserve accurate notes; make the smallest coherent edit.

Dispatch the repository's release workflow:

```bash
gh workflow run release.yml \
  --repo chesapeakedev/dn \
  --ref main \
  -f tag=<tag>
```

Identify the new run rather than assuming an ID, then watch it to completion:

```bash
gh run list --repo chesapeakedev/dn \
  --workflow release.yml --event workflow_dispatch --limit 1
gh run watch <run-id> --repo chesapeakedev/dn --exit-status
```

Do not retry blindly. If the workflow fails, inspect its failed logs and remote
release state first.

## 4. Verify the repaired release

Confirm all of the following:

- the tag ref equals the landed source commit;
- the workflow completed successfully for that commit and tag;
- `checksums.txt` and every expected platform binary exist;
- asset upload times are from the repair run;
- checksum entries exactly cover the binary matrix;
- a downloaded repaired binary passes `dn init workflows --agent opencode` in an
  empty temporary repository;
- the release remains published under the same version and URL;
- the release notes no longer claim superseded behavior.

Report the landed commit, workflow run, release URL, and verification results.
Never claim success from a dispatch alone.
