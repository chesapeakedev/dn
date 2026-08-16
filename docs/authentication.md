# Authentication

`dn` needs a GitHub token for subcommands that access the GitHub API
(`kickstart`, `prep`, `glance`, `peek`, `fixup`, `issue`, `meld` with issue
URLs).

## Token resolution order

Open-source first: prefer credentials you already control. `dn` checks in this
order and uses the first one found:

1. **`GITHUB_TOKEN` environment variable** (or legacy `DANGEROUS_GITHUB_TOKEN`)
2. **GitHub CLI** — if `gh` is installed and authenticated, `dn` shells out to
   `gh auth token`
3. **Cached device-flow token** from `dn auth` (stored in `~/.config/dn/` on
   Unix-like systems or `%APPDATA%\dn` on Windows)

`dn auth` is complementary to `gh`, not a replacement. If you use GitHub CLI,
you do not need to run `dn auth`.

## Interactive: GitHub CLI (preferred)

Install the [GitHub CLI](https://cli.github.com/) and authenticate:

```bash
gh auth login
```

No environment variable or `dn auth` needed — `dn` detects `gh` automatically.

## Interactive: `dn auth` (complementary)

If you do not use `gh`, sign in with the browser device flow:

```bash
dn auth          # or: dn auth login
dn auth status   # show which token source dn would use
dn auth logout   # clear only the dn-cached token (does not affect gh)
```

By default, login uses the public **Denoise GitHub App** client ID (no setup).
Authorizing that app is optional: prefer `gh auth login` or `GITHUB_TOKEN` if
you do not want to use it.

To run device flow with **your own** GitHub App or OAuth App instead, set
`DN_GITHUB_DEVICE_CLIENT_ID` (or `GITHUB_DEVICE_CLIENT_ID`) to that app's client
ID and enable Device flow in the app settings.

The complementary token is cached under `~/.config/dn/` so subsequent `dn`
commands work without re-prompting. It is only used when `GITHUB_TOKEN` and `gh`
are unavailable.

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

**"No GitHub token found"** — Run `gh auth login` (preferred), or `dn auth`, or
set `GITHUB_TOKEN`.

**"Bad credentials" / 401** — The token may be expired or revoked. Re-run
`gh auth login` or `dn auth`, or generate a new PAT. Check with
`dn auth status`.

**"Resource not accessible by integration"** — The token lacks the required
scope. Check the scope table above and update your PAT or workflow permissions.
