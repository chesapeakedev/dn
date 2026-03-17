# Authentication

`dn` needs a GitHub token for subcommands that access the GitHub API
(`kickstart`, `prep`, `glance`, `fixup`, `issue`, `meld` with issue URLs).

## Token resolution order

`dn` checks for a token in this order and uses the first one found:

1. **`GITHUB_TOKEN` environment variable** (or legacy `DANGEROUS_GITHUB_TOKEN`)
2. **Cached device-flow token** from `dn auth` (stored in `~/.dn/`)
3. **GitHub CLI** — if `gh` is installed and authenticated, `dn` shells out to
   `gh auth token`

## Interactive: GitHub CLI (recommended)

Install the [GitHub CLI](https://cli.github.com/) and authenticate:

```bash
gh auth login
```

No environment variable or configuration needed — `dn` detects `gh`
automatically.

## Interactive: Browser device flow

Run `dn auth` to sign in via the browser:

```bash
dn auth
```

The token is cached locally so subsequent commands work without re-prompting.

**Prerequisite**: `DN_GITHUB_DEVICE_CLIENT_ID` (or `GITHUB_DEVICE_CLIENT_ID`)
must be set to your GitHub OAuth App's client ID. Create an OAuth App at
<https://github.com/settings/developers> and enable the Device flow.

## Non-interactive: environment variable

For CI, scripts, and automation, set `GITHUB_TOKEN`:

```bash
export GITHUB_TOKEN=ghp_...
```

A fine-grained Personal Access Token (PAT) is recommended. Grant only the scopes
your workflows require:

| Scope                                     | Needed for                                  |
| ----------------------------------------- | ------------------------------------------- |
| `repo` (or fine-grained `contents: read`) | Reading issues and repo metadata            |
| `issues: write`                           | `dn issue create/edit/close/reopen/comment` |
| `pull_requests: write`                    | AWP mode (creating branches and PRs)        |

## GitHub Actions

In GitHub Actions, `secrets.GITHUB_TOKEN` is automatically available. Pass it as
an environment variable:

```yaml
env:
  GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Ensure the workflow has the permissions it needs:

```yaml
permissions:
  contents: write
  pull-requests: write
  issues: write
```

`dn auth` is not suitable for CI — always use environment variables or injected
secrets.

## Troubleshooting

**"No GitHub token found"** — Run `gh auth login`, `dn auth`, or set
`GITHUB_TOKEN`.

**"Bad credentials" / 401** — The token may be expired or revoked. Re-run
`gh auth login` or generate a new PAT.

**"Resource not accessible by integration"** — The token lacks the required
scope. Check the scope table above and update your PAT or workflow permissions.
