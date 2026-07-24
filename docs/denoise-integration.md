# Denoise Integration

`dn` publishes canonical workflow templates and dispatch contracts so external
tools such as denoise can install workflows, validate repository readiness, and
dispatch agent workflows without scraping markdown or duplicating trigger logic.

## Workflow Templates

Templates live in `templates/workflows/` and install into consumer repositories
under `.github/workflows/`.

| ID                   | Triggers                        | Install path                               |
| -------------------- | ------------------------------- | ------------------------------------------ |
| `dn.init_stack`      | `repository_dispatch`           | `.github/workflows/dn-init-stack.yml`      |
| `dn.meld_issue_plan` | `repository_dispatch`           | `.github/workflows/dn-prep-issue-plan.yml` |
| `dn.kickstart_issue` | `repository_dispatch`           | `.github/workflows/dn-kickstart-issue.yml` |
| `dn.daily_kickstart` | `schedule`, `workflow_dispatch` | `.github/workflows/dn-daily-kickstart.yml` |
| `dn.todo_loop`       | `schedule`, `workflow_dispatch` | `.github/workflows/dn-todo-loop.yml`       |

The machine-readable contract is `templates/workflows/manifest.json`. Each entry
includes the template version, source path, install path, checksum, required
permissions, required and optional secrets, supported triggers, payload schema
version, and minimum compatible `dn` version.

Use the CLI to manage installed workflows and the repo agent preference:

```bash
dn init workflows --agent claude
gh secret set ANTHROPIC_API_KEY
dn workflows list --json
dn workflows update --json
dn workflows validate --json
```

Commit `.github/dn/config.json` and the generated workflows. The action reads
the configured agent, validates the event, and installs only that harness on the
runner. Dispatch payloads do not carry `agent`; the repo config is the source of
truth.

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
- `validate_only` validates configuration without running the mapped command

### `dn.meld_issue_plan`

Required fields:

- `schema_version`
- `dispatch_id`
- exactly one of `issue_url` or `issue_number`

Optional fields:

- `plan_name`
- `validate_only` validates configuration without running the mapped command

The installed workflow also accepts the legacy `dn.prep_issue_plan` event and
routes it through `dn meld`. New integrations should dispatch
`dn.meld_issue_plan`. The installed filename remains `dn-prep-issue-plan.yml`
until the Denoise UI migration tracked in
[chesapeake#399](https://github.com/chesapeakedev/chesapeake/issues/399).

### `dn.kickstart_issue`

Required fields:

- `schema_version`
- `dispatch_id`
- exactly one of `issue_url` or `issue_number`

Optional fields:

- `publish` defaults to `pr` in workflow dispatch (`none`, `pr`, or `direct`)
- `awp` legacy boolean still maps to `pr`/`none`
- `validate_only` validates configuration without running the mapped command

### `dn.init_stack`

Optional fields:

- `stack_mode` defaults to `refresh` in workflow dispatch (`create`, `refresh`,
  or `overwrite`)
- `refresh` legacy boolean maps to `stack_mode` (`true` → refresh, `false` →
  create)
- `publish` defaults to `direct` in CI workflow dispatch

Missing required fields fail the action before running the mapped dn command.
The CLI validates the same rules before dispatch:

```bash
echo '{"schema_version":"1.0","dispatch_id":"'"$(uuidgen)"'","milestone":"1"}' \
  | dn workflows dispatch dn.init_stack --repo owner/repo --json
```

`repository_dispatch` returns HTTP 204 with no run id. Canonical dn templates
copy `client_payload.dispatch_id` into the workflow `run-name` as
`<event_type> · <dispatch_id>`. Pollers must match that exact display title;
creation time alone is not safe when dispatches overlap. To inspect runs:

```bash
gh run list --repo owner/repo --event repository_dispatch
```

Use `dn workflows dispatch --wait` to block until the exactly correlated run
appears, then print its URL. `--wait` requires `client_payload.dispatch_id`.

## Kickstart Progress Events

`dn workflows exec` copies `client_payload.dispatch_id` to `DN_DISPATCH_ID`
before it starts `dn`. Reporting remains disabled unless `DN_PROGRESS` selects a
delivery mode:

| Variable                | Meaning                                                                |
| ----------------------- | ---------------------------------------------------------------------- |
| `DN_DISPATCH_ID`        | Required invocation correlation id; supplied from repository dispatch. |
| `DN_PROGRESS=ndjson`    | Write one event per JSON line to stderr.                               |
| `DN_PROGRESS=http`      | POST events to `DN_PROGRESS_URL` using `DN_PROGRESS_TOKEN`.            |
| `DN_PROGRESS_URL`       | Denoise progress ingest URL for HTTP mode.                             |
| `DN_PROGRESS_TOKEN`     | Bearer token for HTTP mode; never included in events or logs.          |
| `DN_PROGRESS_VERBOSE=1` | Emit redacted `agent.line` events for live agent stdout and stderr.    |

Events use schema version `"1.0"` and have `invocation_id`, monotonically
increasing `seq`, ISO-8601 `ts`, `type`, and a human-readable `message`.
Optional `phase` values are `plan`, `implement`, `lint`, and `publish`; step
events include `step`. `publish.completed` may include `data.branch_name` and
`data.pr_url`. The event types are `invocation.queued`, `invocation.running`,
`step.started`, `step.completed`, `phase.started`, `phase.completed`,
`lint.completed`, `publish.completed`, `invocation.succeeded`, and
`invocation.failed`. When `DN_PROGRESS_VERBOSE=1`, `agent.line` events add a
redacted agent log tail with `data.stream` set to `stdout` or `stderr`.
Recognizable API keys, bearer tokens, and common `TOKEN`/`SECRET` assignments
are replaced before reporting. Sandbox runners currently return captured output,
so their `agent.line` events are flushed after the sandbox command completes.

HTTP delivery is best-effort: a failed request logs one safe diagnostic and does
not fail the kickstart workflow.

## Daily Kickstart

`dn.daily_kickstart` is not a `repository_dispatch` contract. It runs on the
template schedule and supports manual `workflow_dispatch` with optional
`milestone` input. Scheduled runs read the repository variable
`DN_DAILY_KICKSTART_MILESTONE`.

Before enabling the schedule, create and commit the deterministic queue:

```bash
dn init stack 42
gh variable set DN_DAILY_KICKSTART_MILESTONE --body 42
```

The workflow runs:

```bash
dn --agent <configured> kickstart --publish pr --milestone <milestone> --once
```

It processes the first unchecked item in
`plans/{owner}_{repo}_{milestone}.stack.md`, marks that item done after a
successful kickstart, and exits.

## Execution Runtime Matrix

dn distinguishes its agent harness from its execution environment:

| Mechanism                          | Execution location                    | Notes                                                        |
| ---------------------------------- | ------------------------------------- | ------------------------------------------------------------ |
| `--cursor`                         | Current host or GitHub Actions runner | Invokes Cursor's local `agent` CLI.                          |
| `--cursor-cloud`                   | Cursor-managed VM                     | Durable SDK run using `CURSOR_API_KEY`; it is not a sandbox. |
| `--sandbox docker\|exe.dev`        | Docker or exe.dev                     | Isolates any supported local harness.                        |
| Canonical GitHub Actions workflows | GitHub-hosted runner                  | Installs and runs the configured local harness.              |

### Denoise kickstart runtimes

Denoise's task kickstart confirm dialog can select where a run executes. The
client posts `source` on `POST /api/github/dispatch`:

| `source`         | Behavior                                                                 |
| ---------------- | ------------------------------------------------------------------------ |
| `github_actions` | Default. Existing `repository_dispatch` → `dn.kickstart_issue`.          |
| `cursor_cloud`   | Managed runner runs `dn kickstart --cursor-cloud` with HTTP progress.    |
| `cloud_vm`       | Managed runner runs `dn kickstart --sandbox exe.dev` with HTTP progress. |
| `local`          | Managed runner runs host `dn kickstart` with NDJSON progress.            |

Preflight availability is exposed at `GET /api/kickstart/runtimes?owner=&repo=`.
Hosted denoise keeps Docker unavailable (use `dn kickstart --sandbox docker`
locally). Secrets for managed runners stay on the denoise server
(`CURSOR_API_KEY`, `EXE_TOKEN`, `KICKSTART_PROGRESS_BASE_URL`,
`KICKSTART_RUNNER_WORKSPACE_ROOT`).

CLI operators can still invoke Cursor Cloud directly:

```bash
dn kickstart --cursor-cloud --publish pr <issue>
```

With progress env set, that command waits and reports through the same event
contract described in [Kickstart Progress Events](#kickstart-progress-events).

## Permissions And Secrets

Canonical templates request the minimum permissions needed for their workflow:

- `dn.init_stack`: `contents: write`, `issues: write`
- `dn.meld_issue_plan`: `contents: write`, `issues: write`
- `dn.kickstart_issue`: `contents: write`, `pull-requests: write`,
  `issues: write`
- `dn.daily_kickstart`: `contents: write`, `pull-requests: write`,
  `issues: write`

Templates pass `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}` into `dn`. That value
is **not** a repository secret the user creates: GitHub Actions provides it
automatically for every job. The `permissions` block scopes what that token can
do; integrators should not treat `GITHUB_TOKEN` as part of `required_secrets`
when checking the repo’s configured secrets (for example via the GitHub API).

Set the API key for the agent in `.github/dn/config.json` (only one is
required):

| Agent      | Repository secret   | CI notes                          |
| ---------- | ------------------- | --------------------------------- |
| `opencode` | `OPENAI_API_KEY`    | OpenCode install script           |
| `codex`    | `OPENAI_API_KEY`    | Official Codex CLI install script |
| `claude`   | `ANTHROPIC_API_KEY` | `CLAUDE_CODE_BARE=1` in workflow  |
| `cursor`   | `CURSOR_API_KEY`    | Cursor CLI install script         |

Workflows pass all three secrets to `dn`; unset secrets are ignored. Run
`dn workflows validate` to check for a missing config file, outdated install
script, absent agent secret when GitHub auth is available, or missing sandbox
prerequisites when `sandbox.provider` is set in config (see
[Sandbox providers](sandbox.md)).

Schema `1.1` configs may include a `sandbox` block alongside `agent`. Dispatch
payloads still do not carry sandbox settings; repo config remains the source of
truth for CI as well.

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
