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
    redirectUri: "https://example.com/api/auth/github/callback",
  },
});

// Use stable GitHub utilities
const issue = await github.fetchIssueFromUrl(
  "https://github.com/org/repo/issues/123",
);
```

## GitHub App Installation Flow

When your GitHub App needs to be installed on organizations (not only personal
accounts), the SDK supports an installation-first auth flow. Instead of
redirecting directly to `login/oauth/authorize`, the user is sent through the
GitHub App installation page first.

### Configuration

Add `appSlug` to the GitHub OAuth config. The slug is the URL-friendly name from
`https://github.com/apps/<slug>` (not the `client_id`).

```ts
const authHandler = auth.createAuthHandler(kv, {
  github: {
    clientId: Deno.env.get("GITHUB_CLIENT_ID")!,
    clientSecret: Deno.env.get("GITHUB_CLIENT_SECRET")!,
    redirectUri: "https://example.com/api/auth/github/callback",
    appSlug: Deno.env.get("GITHUB_APP_SLUG"),
  },
});
```

| Environment variable   | Description                                         |
| ---------------------- | --------------------------------------------------- |
| `GITHUB_CLIENT_ID`     | OAuth App client ID (unchanged)                     |
| `GITHUB_CLIENT_SECRET` | OAuth App client secret (unchanged)                 |
| `GITHUB_APP_SLUG`      | URL-friendly app name from `github.com/apps/<slug>` |

### Required GitHub App Settings

The GitHub App must be configured with the following URLs:

| Setting                                                    | Value                                                                                   |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **User authorization callback URL**                        | Your callback route, e.g. `https://example.com/api/auth/github/callback`                |
| **Setup URL** (post-installation redirect)                 | The route serving `handleGitHubSetup`, e.g. `https://example.com/api/auth/github/setup` |
| **Request user authorization (OAuth) during installation** | **Enabled** — ensures the user is sent through OAuth after install                      |

### Auth Flow

1. User clicks "Sign in with GitHub"
2. `handleGitHubAuth` generates a `state` token and redirects to
   `https://github.com/apps/<slug>/installations/new?state=<state>`
3. User selects an org/account and installs (or skips if already installed)
4. GitHub redirects to the **Setup URL** with `state`, `installation_id`, and
   `setup_action`
5. `handleGitHubSetup` validates the state, stores the `installation_id`, and
   redirects to `https://github.com/login/oauth/authorize?...&state=<state>`
6. User authorizes the OAuth app
7. GitHub redirects to the **callback URL** with `code` and `state`
8. `handleGitHubCallback` completes the token exchange and creates a session

### Route Wiring

```ts
// Auth entry — redirects to install page when appSlug is set
app.get("/api/auth/github", (req) => authHandler.handleGitHubAuth(req));

// Setup URL — GitHub redirects here after app installation
app.get("/api/auth/github/setup", (req) => authHandler.handleGitHubSetup(req));

// Callback — unchanged from standard OAuth
app.get(
  "/api/auth/github/callback",
  (req) => authHandler.handleGitHubCallback(req),
);
```

### Bypassing Installation

To skip the installation step and redirect straight to OAuth (useful for
returning users who already have the app installed), pass `?flow=oauth_only`:

```
GET /api/auth/github?flow=oauth_only
```

### Lower-Level Helpers

For consumers who need more control than the full HTTP handlers provide:

- **`initiateGitHubAuth(kv, config, authConfig?, options?)`** — generates state,
  stores it in KV, and returns `{ url, state }`. The URL is either the install
  page or the direct OAuth authorize URL depending on `appSlug` and
  `options.oauthOnly`.
- **`validateGitHubCallback(code, state, kv, config)`** — validates state,
  exchanges the code for a token, resolves the GitHub user, and returns
  `{ user, accessToken }`. The consumer handles session creation.

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
