# Contributing to dn

Thank you for your interest in contributing to dn! This document provides
guidelines and instructions for being productive on the project.

This project is an (increasingly common) experiment in working one layer above
the code itself. Contributors should utilize automation in the repo to
understand the changes they want made to the project and create a high quality
github issue describing the change. The issue is reviewed (instead of a pull
request), and a contributor applies a label to kickoff an agent implementation
of the ticket. Contributors then review, edit, and merge the change.

Forms of verification that humans & agents can use are critical to maintaining
the quality of the software. Keeping agents aligned to the intent of the
software is a continuous task of annotating code and adding markdown context to
the repository.

Software engineers will naturally have an easier time with reviewing pull
requests & being stewards of the repo, but maintaining a quality list of issues
and testing changes is something anyone can have huge impact with. This process
lets everyone build.

## Coding Style

A specific strategy for organization of the repo or patterns in the code is not
strictly enforced. As you make changes manually and through LLM usage, the
linter & AGENTS.md are a means to slowly chop away at the accrued technical
debt. Some loose guidelines:

- **TypeScript is mandatory** - avoid `any`, types are important context for
  agents
- **Formatting** - use `make fmt` to avoid thinking about it
- **Type Checking & Linting** - use `make lint`; we accept 0 linter issues
- **Public APIs must be documented** - any exported function, class, or type
  intended for reuse must include behavior-focused TSDoc describing usage and
  error behavior

See [AGENTS.md](AGENTS.md) for an understanding of what the agents are
instructed to do. Many times the advice generalizes. Quality contributions to
`AGENTS.md` is highly valuable.

This project uses `make` as a task runner, both locally and in CI. Read through
the [Makefile](./Makefile) to understand useful commands in the project.
**`make sync`** runs **`dn sync`** (Sapling pull/rebase, optional restack,
conditional push to `main`); see **`AGENTS.md`** and **`docs/subcommands.md`**.

## Documentation

Before submitting a pull request, consider asking an LLM to update the
documentation with the changes you've made. In addition, hand-made documentation
improvements are always welcome and an important part of quality control:

- Fix typos or clarify existing docs
- Add examples or context on use cases
- Improve TSDoc comments
- Update README or AGENTS.md

## Kickstart internals

Kickstart is part of the `dn` CLI, not a separately invoked application. Its
phase-specific system prompts live under `kickstart/system.prompt.*.md` and are
embedded in release binaries by `compile_dn.sh`. When adding a prompt, update
the include list in that script so development and compiled executions behave
the same way.

The plan phase may write only its target plan. A valid plan contains a title,
`Overview`, `Implementation Plan`, and `Acceptance Criteria` sections, with at
least one markdown checkbox under `Acceptance Criteria`. Plans normally live at
`plans/<name>.plan.md`. The implementation phase must update those checkboxes;
`dn` uses them to report completion and make the plan resumable with `dn loop`.

Agent prompts are assembled in this order, with markdown horizontal rules
between sections:

1. The phase-specific system prompt
2. The workspace's `AGENTS.md`, when present
3. The workspace's `deno.json`, when present
4. Existing plan or target content, when continuing or merging
5. Plan-phase output, for implementation
6. GitHub issue or local markdown context

GitHub issue context includes a curated `Relationships` section for parent,
sub-issue, blocker, and duplicate relationships. Keep this representation
compact: relationship totals may exceed the listed references.

## Creating GitHub Releases

Run the release target from a clean working copy:

```bash
make release
```

This will:

1. Read the current version from `deno.json`
2. Find the previous release commit whose subject starts with that version
3. Summarize commits since that release
4. Bump the patch version in `deno.json`
5. Run `make precommit`
6. Commit the version bump with `sl commit`
7. Run `make sync` (same as **`dn sync`**)
8. Create the GitHub release with `dn release create`

Use a dry run to preview the detected version and generated notes without
changing files:

```bash
deno run --allow-read --allow-run scripts/release.ts --dry-run
```

The manual version bump targets remain available for non-patch releases:

```bash
make bump_patch
make bump_minor
make bump_major
```

## Github Actions Release Workflow

When a new release is published on GitHub, the workflow in
`.github/workflows/release.yml` automatically builds and distributes binaries.

### Build Job

The workflow runs a matrix build across five platform targets using
`compile_dn.sh` (embedded kickstart prompts and workflow templates):

| Runner          | Target                      | Output Binary        |
| --------------- | --------------------------- | -------------------- |
| `ubuntu-latest` | `x86_64-unknown-linux-gnu`  | `dn-linux-x64`       |
| `ubuntu-latest` | `aarch64-unknown-linux-gnu` | `dn-linux-arm64`     |
| `macos-latest`  | `x86_64-apple-darwin`       | `dn-macos-x64`       |
| `macos-latest`  | `aarch64-apple-darwin`      | `dn-macos-arm64`     |
| `ubuntu-latest` | `x86_64-pc-windows-msvc`    | `dn-windows-x64.exe` |

Each binary is uploaded as a GitHub Actions artifact with 1-day retention. macOS
binaries are signed with a Developer ID Application certificate and notarized
via `scripts/macos_sign_and_notarize.sh` before upload. Details about the
binary:

- **Runtime:** Deno 2.x
- **Build command:** `./compile_dn.sh --target <triple> -o <binary>`
- **Included files:** Kickstart system prompts, `kickstart.mdc`, and workflow
  templates under `templates/workflows/` (see `compile_dn.sh`)

Checksums generated via `sha256sum`:

```bash
sha256sum dn-linux-x64 dn-linux-arm64 dn-macos-x64 dn-macos-arm64 dn-windows-x64.exe > checksums.txt
```

Binary Naming Format: `dn-{os}-{arch}` where:

- `os`: `linux`, `macos`, `windows`
- `arch`: `x64`, `arm64`

### macOS signing secrets

Configure these repository secrets (Settings → Secrets and variables → Actions)
before the next macOS release build. Without them, the macOS matrix jobs fail at
the sign/notarize step.

| Secret                       | Value                                                                |
| ---------------------------- | -------------------------------------------------------------------- |
| `APPLE_CERTIFICATE_BASE64`   | Base64-encoded Developer ID Application `.p12`                       |
| `APPLE_CERTIFICATE_PASSWORD` | Password used when exporting the `.p12`                              |
| `APPLE_API_KEY`              | Full contents of the App Store Connect API `.p8` private key         |
| `APPLE_API_KEY_ID`           | Key ID shown in App Store Connect for that `.p8`                     |
| `APPLE_API_ISSUER_ID`        | Issuer ID (UUID) from App Store Connect → Users and Access → Keys    |
| `APPLE_SIGNING_IDENTITY`     | Optional. Exact `codesign` identity string; auto-detected if omitted |

Encode the certificate on macOS:

```bash
base64 -i DeveloperID.p12 | pbcopy
```

Paste into `APPLE_CERTIFICATE_BASE64`. For `APPLE_API_KEY`, paste the entire
`.p8` file body (including the `BEGIN PRIVATE KEY` / `END PRIVATE KEY` lines).

Local dry-run of the same script (after exporting the env vars):

```bash
./compile_dn.sh -o dn-macos-local
./scripts/macos_sign_and_notarize.sh dn-macos-local
```

### Homebrew tap

Prebuilt binaries are packaged in
[`chesapeakedev/homebrew-dn`](https://github.com/chesapeakedev/homebrew-dn).
The Release Binary workflow bumps `Formula/dn.rb` automatically after assets
upload, using secret `HOMEBREW_TAP_TOKEN`.

Create a fine-grained personal access token with **Contents: Read and write** on
`chesapeakedev/homebrew-dn`, then add it as repository secret
`HOMEBREW_TAP_TOKEN` on `chesapeakedev/dn`. To temporarily skip the job, set
repository variable `HOMEBREW_TAP_AUTOMATION=disabled`.

Manual bump (optional / recovery):

```bash
deno run -A scripts/bump_homebrew_formula.ts --version <x.y.z>
cd ../homebrew-dn
git add Formula/dn.rb
git commit -m "dn <x.y.z>"
git push
```

### Adding New Platforms

1. Add target to `.github/workflows/release.yml` matrix
2. Update `compile_dn.sh` if needed
3. Update `install.sh` with detection logic
4. Extend `scripts/bump_homebrew_formula.ts` platform list if the Homebrew
   formula should install the new asset

### Release Job

After all builds complete, the release job:

1. Downloads all artifacts
2. Generates SHA256 checksums via `sha256sum` into `checksums.txt`
3. Uploads all binaries and `checksums.txt` to the GitHub release using
   `softprops/action-gh-release@v2` with `generate_release_notes: true`
4. Bumps and pushes `chesapeakedev/homebrew-dn` when `HOMEBREW_TAP_TOKEN` is set

## Debugging

When running kickstart workflows, debug files are preserved in temporary
directories with prefixes like `geo-opencode-`, `geo-prep-`, `geo-fixup-`, or
`dn-score-`. By default, these directories are deleted on success and kept on
failure.

Set `SAVE_CTX=1` to preserve debug files on success as well.

### Debug files by phase

Different workflow phases write different debug files to the temp directory:

| File                            | Phase(s)               | Purpose                                  |
| ------------------------------- | ---------------------- | ---------------------------------------- |
| `combined_prompt_plan.txt`      | plan                   | Full combined prompt for plan phase      |
| `combined_prompt_implement.txt` | implement, loop, fixup | Full combined prompt for implement phase |
| `combined_prompt_prep.txt`      | prep                   | Full combined prompt for prep phase      |
| `combined_prompt_merge.txt`     | merge                  | Full combined prompt for merge phase     |
| `plan_output.txt`               | plan, fixup            | Plan phase output                        |
| `plan_stdout.txt`               | plan                   | Plan phase stdout                        |
| `plan_stderr.txt`               | plan                   | Plan phase stderr                        |
| `implement_stdout.txt`          | implement              | Implement phase stdout                   |
| `implement_stderr.txt`          | implement              | Implement phase stderr                   |
| `issue-context.md`              | plan, prep             | Formatted GitHub issue context           |
| `system.prompt.plan.md`         | plan                   | Plan system prompt                       |
| `system.prompt.implement.md`    | implement              | Implement system prompt                  |
| `system.prompt.prep.md`         | prep                   | Prep system prompt                       |
| `system.prompt.merge.md`        | merge                  | Merge system prompt                      |
| `system.prompt.fixup.md`        | fixup                  | Fixup system prompt                      |

### On failure

When a kickstart workflow fails, debug file paths are printed to stderr:

```
Debug information:
  - Temp directory: /var/folders/xx/geo-opencode-xxxxx
  - Plan prompt: /var/folders/xx/geo-opencode-xxxxx/combined_prompt_plan.txt
  - Implement prompt: /var/folders/xx/geo-opencode-xxxxx/combined_prompt_implement.txt
  - Plan output: /var/folders/xx/geo-opencode-xxxxx/plan_output.txt
  - Issue context: /var/folders/xx/geo-opencode-xxxxx/issue-context.md

Debug files preserved in: /var/folders/xx/geo-opencode-xxxxx
Set SAVE_CTX=1 to preserve files on success as well.
```
