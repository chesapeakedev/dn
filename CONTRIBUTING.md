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

## Documentation

Before submitting a pull request, consider asking an LLM to update the
documentation with the changes you've made. In addition, hand-made documentation
improvements are always welcome and an important part of quality control:

- Fix typos or clarify existing docs
- Add examples or context on use cases
- Improve TSDoc comments
- Update README or AGENTS.md

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
7. Run `make sync`
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
`deno compile --allow-all --config deno.json`:

| Runner          | Target                      | Output Binary        |
| --------------- | --------------------------- | -------------------- |
| `ubuntu-latest` | `x86_64-unknown-linux-gnu`  | `dn-linux-x64`       |
| `ubuntu-latest` | `aarch64-unknown-linux-gnu` | `dn-linux-arm64`     |
| `macos-latest`  | `x86_64-apple-darwin`       | `dn-macos-x64`       |
| `macos-latest`  | `aarch64-apple-darwin`      | `dn-macos-arm64`     |
| `ubuntu-latest` | `x86_64-pc-windows-msvc`    | `dn-windows-x64.exe` |

Each binary is uploaded as a GitHub Actions artifact with 1-day retention.
Details about the binary:

- **Runtime:** Deno 2.x
- **Build command:** `deno compile --allow-all -o <output> cli/main.ts`
- **Included files:** System prompts from `kickstart/` directory

Checksums generated via `sha256sum`:

```bash
sha256sum dn-linux-x64 dn-linux-arm64 dn-macos-x64 dn-macos-arm64 dn-windows-x64.exe > checksums.txt
```

Binary Naming Format: `dn-{os}-{arch}` where:

- `os`: `linux`, `macos`, `windows`
- `arch`: `x64`, `arm64`

### Adding New Platforms

1. Add target to `.github/workflows/release.yml` matrix
2. Update `compile_dn.sh` if needed
3. Update `install.sh` with detection logic
4. Update Homebrew formula with URL and SHA256

### Release Job

After all builds complete, the release job:

1. Downloads all artifacts
2. Generates SHA256 checksums via `sha256sum` into `checksums.txt`
3. Uploads all binaries and `checksums.txt` to the GitHub release using
   `softprops/action-gh-release@v2` with `generate_release_notes: true`

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

### Combined prompt structure

Each `combined_prompt_*.txt` file is assembled from multiple sources in order,
separated by `---`:

1. System prompt (phase-specific)
2. `AGENTS.md` (if present in project root)
3. `deno.json` (if present in project root)
4. Previous plan content (in continuation mode)
5. Plan output (in implement phase)
6. Issue context (when fetched from GitHub)

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
