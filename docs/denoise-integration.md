# Denoise Integration

`dn` publishes canonical workflow templates and dispatch contracts so external
tools such as denoise can install workflows, validate repository readiness, and
dispatch agent workflows without scraping markdown or duplicating trigger logic.

## Workflow Templates

Templates live in `templates/workflows/` and install into consumer repositories
under `.github/workflows/`.

| ID                   | Dispatch event       | Install path                               |
| -------------------- | -------------------- | ------------------------------------------ |
| `dn.init_stack`      | `dn.init_stack`      | `.github/workflows/dn-init-stack.yml`      |
| `dn.prep_issue_plan` | `dn.prep_issue_plan` | `.github/workflows/dn-prep-issue-plan.yml` |
| `dn.kickstart_issue` | `dn.kickstart_issue` | `.github/workflows/dn-kickstart-issue.yml` |

The machine-readable contract is `templates/workflows/manifest.json`. Each entry
includes the template version, source path, install path, checksum, required
permissions, required and optional secrets, supported triggers, payload schema
version, and minimum compatible `dn` version.

Use the CLI to manage installed workflows:

```bash
dn init workflows
dn workflows list --json
dn workflows update --json
dn workflows validate --json
```

## Dispatch Payloads

All canonical `repository_dispatch` payloads use `schema_version: "1.0"` and
require a caller-generated `dispatch_id` for correlation.

### `dn.init_stack`

Required fields:

- `schema_version`
- `dispatch_id`
- `milestone`

Optional fields:

- `refresh` defaults to `true`
- `agent`

### `dn.prep_issue_plan`

Required fields:

- `schema_version`
- `dispatch_id`
- exactly one of `issue_url` or `issue_number`

Optional fields:

- `plan_name`
- `agent`

### `dn.kickstart_issue`

Required fields:

- `schema_version`
- `dispatch_id`
- exactly one of `issue_url` or `issue_number`

Optional fields:

- `agent` defaults to `opencode`
- `awp` defaults to `true`

Missing required fields fail the workflow before running `dn`. The CLI validates
the same rules before dispatch:

```bash
echo '{"schema_version":"1.0","dispatch_id":"'"$(uuidgen)"'","milestone":"1"}' \
  | dn workflow run dn.init_stack --repo owner/repo --json
```

`repository_dispatch` returns HTTP 204 with no run id. After dispatch, poll for
runs:

```bash
gh run list --repo owner/repo --event repository_dispatch
```

Use `dn workflow run --wait` to block until a new run appears, then print its
URL.

## Permissions And Secrets

Canonical templates request the minimum permissions needed for their workflow:

- `dn.init_stack`: `contents: write`, `issues: write`
- `dn.prep_issue_plan`: `contents: write`, `issues: write`
- `dn.kickstart_issue`: `contents: write`, `pull-requests: write`,
  `issues: write`

Templates pass `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}` into `dn`. That value
is **not** a repository secret the user creates: GitHub Actions provides it
automatically for every job. The `permissions` block scopes what that token can
do; integrators should not treat `GITHUB_TOKEN` as part of `required_secrets`
when checking the repo’s configured secrets (for example via the GitHub API).

Agent-specific API keys are optional at the manifest level because they depend
on the selected agent, but `dn.kickstart_issue` exposes `OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`, and `CURSOR_API_KEY` to support opencode, codex, Claude,
and Cursor workflows.

## Stack JSON Contract

`dn init stack` writes both a human-readable markdown file and a structured JSON
artifact. The filenames include the repository owner and name so milestones from
different repositories do not collide:

- `plans/{owner}_{repo}_{milestone}.stack.md`
- `plans/{owner}_{repo}_{milestone}.stack.json`

The JSON artifact is the parsing contract for integrations. It includes schema
version, repository, milestone number/title, generation timestamp, issue entries
with title and score, disqualification reasons, and explicit kickstart order.

Scores use Fibonacci values `1`, `2`, `3`, `5`, and `8`, where lower scores are
worked first. Missing or unsuitable scores disqualify an issue from the
kickstart order and preserve the reason in the JSON artifact. Ties keep the
scoring result order.

## Compatibility

`repository_dispatch` is the canonical denoise integration path. Existing manual
workflows, issue labels such as `denoise-build`, `cursor awp`, and
`opencode awp`, and documented comment triggers remain supported compatibility
paths. They do not take precedence over dispatch events; each trigger runs only
the workflow that received it.
