# dn API

`dn` exposes both a CLI and a programmatic SDK. The SDK is published on
**jsr.io** and follows explicit API stability rules:

- **Stable APIs**: Symbols exported from `@dn/sdk` top-level namespaces (for
  example `auth` and `github`) are considered stable across minor versions.
- **Behavior-focused contracts**: All public symbols are documented with TSDoc
  that describes behavior, guarantees, and error conditions rather than
  implementation details.
- **No accidental exports**: Internal helpers, low-level primitives, and
  workflow-specific utilities are intentionally not part of the public API and
  may change without notice.
- **Breaking changes**: Changes to stable APIs follow semantic versioning and
  are avoided unless strongly justified.

Consumers should rely only on documented, exported symbols and avoid deep or
internal imports, which are not supported as part of the public contract.

## Minimal SDK Usage

```ts
import { auth, github } from "@dn/sdk";

// Create a stable auth handler
const authHandler = auth.createAuthHandler(kv, {
  github: {
    clientId: "GITHUB_CLIENT_ID",
    clientSecret: "GITHUB_CLIENT_SECRET",
  },
});

// Use stable GitHub utilities
const issue = await github.fetchIssueFromUrl(
  "https://github.com/org/repo/issues/123",
);
```

## Using the Programmatic SDK in Github Actions

The SDK can be used directly when you need tighter control than the CLI
provides, such as embedding `dn` capabilities into custom automation.

Below is a complete GitHub Actions example that installs Deno, runs a small
TypeScript script using the `@dn/sdk`, and posts a useful summary derived from
an issue. This pattern works well for CI checks, reporting, or automation that
needs structured access to GitHub data.

A Github Actions script could enforce policy (for example, blocking closed or
labeled issues) by failing the job with a thrown error.

> **Note**: This example is illustrative. In practice, many of these workflows
> can be accomplished more simply with `gh` and bash scripts.

```yaml
name: dn-sdk-example

on:
  workflow_dispatch:
    inputs:
      issue_url:
        description: "GitHub issue URL to analyze"
        required: true
        default: "https://github.com/org/repo/issues/123"

jobs:
  analyze-issue:
    runs-on: ubuntu-latest
    steps:
      - name: Check out repository
        uses: actions/checkout@v4

      - name: Install Deno
        uses: denoland/setup-deno@v1
        with:
          deno-version: v2.x

      - name: Run dn SDK script
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          deno run --allow-net --allow-env <<'EOF'
          import { github } from "@dn/sdk";

          const issueUrl = Deno.env.get("ISSUE_URL") ?? "${{ inputs.issue_url }}";

          const issue = await github.fetchIssueFromUrl(issueUrl);

          // Example: emit a short, structured summary for CI logs
          console.log("Issue summary:");
          console.log("- Title:", issue.title);
          console.log("- State:", issue.state);
          console.log("- Author:", issue.author.login);
          console.log("- Labels:", issue.labels.map(l => l.name).join(", "));
          console.log("- Comments:", issue.commentCount);

          // Fail the job if the issue is closed or labeled as blocked
          const blockedLabels = new Set(["blocked", "do-not-merge"]);
          const hasBlockedLabel = issue.labels.some(l => blockedLabels.has(l.name));

          if (issue.state === "closed" || hasBlockedLabel) {
            throw new Error("Issue is not actionable for CI automation");
          }
          EOF
```

Avoid interactive auth flows like `dn auth` in CI; always rely on environment
variables or injected secrets.
