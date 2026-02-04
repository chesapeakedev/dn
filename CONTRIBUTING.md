# Contributing to dn

Thank you for your interest in contributing to dn! This document provides
guidelines and instructions for being productive on the project.

This project is not developed, it's orchestrated. As a contributor, your first
role is to manage the codebase as a product. To take action, update markdown in
the repo or create & comment on github issues. Message other contributors to
build consensus.

Then, use dn to build dn

Your secondary role is to review pull requests & manage change in the
respository. Reduce LLM artifacts in generated pull requests. Run quality
programs over the codebase. Make it easier to contribute and easier to verify
programmatically and by an LLM that a feature works.

Software engineers will naturally have an easier time with reviewing pull
requests & being stewards of the repo, but this two-step process lets everyone
build. As a product manager or other non-SWE contributor, testing can replace
manual review of the code. Additionally, hardening a plan in github will have a
huge impact on the generated output of the kickstart process

## Code Style

Style is not strictly enforced. As you make changes manually and through LLM
usage, the linter & AGENTS.md are configured to slowly chop away at the accrued
technical debt. Some loose guidelines that may be helpful:

- **TypeScript is mandatory** - no `any` allowed
- **Formatting** - use `make fmt` to avoid thinking about it
- **Type Checking & Linting** - use `make lint`; we accept 0 linter issues
- **Public APIs must be documented** - any exported function, class, or type intended for reuse must include behavior-focused TSDoc describing guarantees and error behavior

See [AGENTS.md](AGENTS.md) for an understanding of what the agents are
instructed to do. Many times the advice generalizes

## Makefile

This project uses `make` as a task runner, both locally and in CI. Read through
the [Makefile](./Makefile) to understand useful commands in the project.

## Project Structure

The dn repository is organized around the CLI and its supporting workflows. The
structure is intentionally explicit so both humans and LLMs can navigate and
reason about changes.

Understanding the project structure will help you contribute effectively:

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

## Creating Pull Requests

dn is designed to be contributed to from multiple roles. You can meaningfully
improve the project without writing TypeScript, or you can work directly in the
codebase as a developer.

### Contributing as a Product Manager

- Shape high-quality GitHub issues with clear goals, constraints, and examples
  - Example: write an issue that includes acceptance criteria, non-goals, and a
    concrete "done looks like" section
- Break large ideas into smaller, testable milestones (splitting one ticket into
  many)
  - Example: split "Add new kickstart mode" into planning, artifact generation,
    and CLI wiring issues
- Use the `dn` CLI to turn intent into concrete artifacts
  - `dn <issue_url>` to generate a structured plan from a GitHub issue
  - `dn <issue_url> --loop` to iterate on the plan and implementation
  - `dn --awp <issue_url>` to produce a branch, commits, and a draft PR
- Review generated artifacts for scope, correctness, and clarity
  - Check plans and prompts for missing constraints or unintended expansion
  - Consider a developer teammate that may be suitable for review
- Validate behavior in pull requests by testing locally
  - Run the modified CLI or workflow and verify it matches the issue goals

Injecting clear intent and feedback into the project is a significant
contribution.

### Contributing as a Developer

- Review pull requests, refining kickstart plans & generated code
- Edit generated code to remove LLM artifacts and improve clarity
- Add or improve tests to add reliability to product behavior & LLM awareness
- Refactor incrementally to keep modules small and explicit
- Run linting, type checks, and tests and steward the project towards keeping
  these passing

### Submitting Your Changes

The agent you are using should be able to use `dn` to submit pull requests on
your behalf using either `git` or `sl`. Consider running `make precommit` to run
basic checks on larger changes to save yourself time. If you run into issues as
a non-SWE, reach out in chat!

## Documentation

Before submitting a pull request, consider asking an LLM to update the
documentation with the changes you've made. In addition, hand-made documentation
improvements are always welcome and an important part of quality control:

- Fix typos or clarify existing docs
- Add examples or use cases
- Improve code comments
- Update README or AGENTS.md

## Testing Guidelines

- **Write tests** for new functionality
- **Test edge cases** and error conditions
- **Keep tests isolated** - each test should be independent
- **Use descriptive test names** that explain what is being tested
- **Prefer testing behavior** over implementation details

Example test structure:

```typescript
Deno.test("functionName handles edge case", () => {
  // Arrange
  const input = "...";

  // Act
  const result = functionName(input);

  // Assert
  assertEquals(result, expected);
});
```

More to come here...

## Debugging

This section reflects the current kickstart debugging behavior.

When running kickstart workflows, debug files are preserved in
`/tmp/geo-opencode-{pid}/`:

- `combined_prompt.txt` - Full prompt sent to opencode
- `opencode_stdout.txt` - Standard output
- `opencode_stderr.txt` - Standard error
- `issue-context.md` - Formatted issue context

Set `SAVE_CTX=1` to preserve debug files on success.
