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

Actions runs are unattended, so GitHub issue targets need approval. Canonical
`workflows exec` maps this dispatch to `dn meld --yes …`. The installed workflow
also sets `DN_YES: "1"` so older dn binaries still approve the write before that
mapping ships via dn-action.

### `dn.kickstart_issue`

Required fields:

- `schema_version`
- `dispatch_id`
- exactly one of `issue_url` or `issue_number`

Optional fields:

- `publish` may be omitted or set to `pr`
- `awp` may be omitted or set to `true`
- `validate_only` validates configuration without running the mapped command

Canonical Actions dispatches reject `none`, `direct`, and `awp: false`. Those
publish modes remain available for explicit local CLI invocations.

### `dn.init_stack`

Optional fields:

- `stack_mode` defaults to `refresh` in workflow dispatch (`create`, `refresh`,
  or `overwrite`)
- `refresh` legacy boolean maps to `stack_mode` (`true` → refresh, `false` →
  create)
- `publish` may be omitted or set to `pr`

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

Denoise’s primary web runners — **GitHub Actions**, **exe.dev (`cloud_vm`)**,
and **Cursor Cloud** — share one HTTP progress bootstrap:

- `DN_DISPATCH_ID` — invocation / `dispatch_id` correlation
- `DN_PROGRESS=http`
- `DN_PROGRESS_URL` —
  `{KICKSTART_PROGRESS_BASE_URL}/api/kickstart/invocations/{id}/events`
- `DN_PROGRESS_TOKEN` — per-invocation bearer issued by denoise (not a shared
  repo secret)

Managed runners receive these as child-process env. For GitHub Actions, denoise
nests `client_payload.progress: { mode, url, token }` when
`KICKSTART_PROGRESS_BASE_URL` is an HTTPS URL the runner can reach.
`dn workflows exec` exports that object to the same `DN_PROGRESS*` env vars.
Without the public base URL, Actions stays available but the web panel uses
**coarse** status (queued / running / terminal) instead of the phase timeline.

`dn workflows exec` always copies `client_payload.dispatch_id` to
`DN_DISPATCH_ID`. Reporting remains disabled unless `DN_PROGRESS` selects a
delivery mode:

| Variable                | Meaning                                                                |
| ----------------------- | ---------------------------------------------------------------------- |
| `DN_DISPATCH_ID`        | Required invocation correlation id; supplied from repository dispatch. |
| `DN_PROGRESS=ndjson`    | Write one event per JSON line to stderr (device runners).              |
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

Do **not** mint a shared `DN_PROGRESS_TOKEN` repository secret for every target
repo. Per-invocation tokens are issued by denoise and delivered through the
runner bootstrap (managed env or Actions `client_payload.progress`).

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
`plans/{owner}_{repo}_{milestone}.stack.md`. The implementation and completed
stack checkbox are committed to the same PR, so merging the PR advances code and
queue atomically. If that issue already has an open kickstart PR, later runs
report its URL and skip duplicate work.

`dn.todo_loop` checks out a stable branch derived from its plan path. Each run
commits its progress to that branch and opens or advances one recurring PR.

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
| `device_runner`  | Named developer device claims a typed kickstart job over outbound HTTPS. |

Preflight availability is exposed at `GET /api/kickstart/runtimes?owner=&repo=`.
Hosted denoise keeps Docker unavailable (use `dn kickstart --sandbox docker`
locally). Denoise does **not** run kickstart on the application host. Secrets
for managed runners stay on the denoise server (`CURSOR_API_KEY`, `EXE_TOKEN`,
`KICKSTART_PROGRESS_BASE_URL`, `KICKSTART_RUNNER_WORKSPACE_ROOT`).

`device_runner` is an instance runtime. Dispatch requests include `runner_id`
alongside `source`; the server must verify that the signed-in owner owns the
runner and has registered the target repository. Historical invocations may
still show `source: "local"` in progress history; new dispatches reject it.

### Device runner API contract

Protocol version `1.0` uses the following authenticated routes under
`/api/runners`. Pairing creation, polling, and exchange are unauthenticated but
require the short-lived pairing secrets returned by the preceding step.

| Method | Route                              | Purpose                                       |
| ------ | ---------------------------------- | --------------------------------------------- |
| POST   | `/pairings`                        | Create browser-approved pairing request       |
| POST   | `/pairings/:id/status`             | Poll with the short-lived pairing token       |
| POST   | `/pairings/:id/exchange`           | Return the runner credential exactly once     |
| POST   | `/heartbeat`                       | Report protocol, capabilities, and readiness  |
| POST   | `/jobs/claim`                      | Atomically long-poll and claim one job        |
| POST   | `/jobs/:id/lease`                  | Renew a lease and receive cancellation state  |
| POST   | `/jobs/:id/progress`               | Ingest one existing progress event            |
| POST   | `/jobs/:id/complete`               | Record the completion receipt                 |
| POST   | `/jobs/:id/fail`                   | Record failure, cancellation, or interruption |
| GET    | `/status`                          | Return owner-visible device state             |
| GET    | `/jobs`                            | Return owner-visible recent jobs              |
| POST   | `/kickstart`                       | Queue one typed kickstart job                 |
| POST   | `/pause`, `/resume`, `/disconnect` | Owner controls                                |
| POST   | `/credential/rotate`               | Replace and invalidate a runner credential    |

Runner credentials are scoped, expiring bearer values stored with mode `0600` on
the device. Store only their hashes server-side. Revocation and rotation
invalidate the previous value immediately.

Heartbeat repository entries contain `owner/repo`, readiness, and an optional
reason. They never contain local paths. Jobs contain opaque IDs, invocation and
runner IDs, repository slug, issue URL or task document, publish mode, agent
harness, timestamps, and lease state. Protocol v1 accepts `kickstart` and
`denoise-task` operation types.

Queue offline jobs for at most 24 hours and do not fall back to a hosted
runtime. Claim one job per runner atomically. A reconnect after lease loss marks
the old job interrupted; retry requires a new explicit dispatch.

Gate these routes and runtime choices behind the device-runner feature flag and
reject clients below the configured minimum protocol version with HTTP 426.
Derive privacy-safe funnel metrics from pairing, readiness, claim, and terminal
events. Metrics may include time to first job, completion reason, local compute
minutes, and hosted runs avoided; they must not include machine serials, local
paths, source, credentials, or unredacted logs.

See [Developer device runners](device-runners.md) for CLI onboarding and the
local security boundary.

CLI operators can still invoke Cursor Cloud directly:

```bash
dn kickstart --cursor-cloud --publish pr <issue>
```

With progress env set, that command waits and reports through the same event
contract described in [Kickstart Progress Events](#kickstart-progress-events).

## Permissions And Secrets

Canonical templates request the minimum permissions needed for their workflow:

- `dn.init_stack`: `contents: write`, `pull-requests: write`, `issues: write`
- `dn.meld_issue_plan`: `contents: read`, `issues: write`
- `dn.kickstart_issue`: `contents: write`, `pull-requests: write`,
  `issues: write`
- `dn.daily_kickstart`: `contents: write`, `pull-requests: write`,
  `issues: write`
- `dn.todo_loop`: `contents: write`, `pull-requests: write`, `issues: write`

`contents: write` permits a workflow to push a topic branch. Opening the
corresponding PR also requires `pull-requests: write`. Canonical workflows never
push automation changes directly to the default branch.

Templates pass `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}` into `dn`. That value
is **not** a repository secret the user creates: GitHub Actions provides it
automatically for every job. The `permissions` block scopes what that token can
do; integrators should not treat `GITHUB_TOKEN` as part of `required_secrets`
when checking the repo’s configured secrets (for example via the GitHub API).

Set the API key for the agent in `.github/dn/config.json` (only one is
required):

| Agent      | Repository secret      | CI notes                          |
| ---------- | ---------------------- | --------------------------------- |
| `opencode` | `OPENAI_API_KEY`       | OpenCode install script           |
| `codex`    | `OPENAI_API_KEY`       | Official Codex CLI install script |
| `claude`   | `ANTHROPIC_API_KEY`    | `CLAUDE_CODE_BARE=1` in workflow  |
| `cursor`   | `CURSOR_API_KEY`       | Cursor CLI install script         |
| `copilot`  | `COPILOT_GITHUB_TOKEN` | Copilot CLI install script        |

Workflows pass all four secrets to `dn`; unset secrets are ignored. Run
`dn workflows validate` to check for a missing config file, outdated install
script, absent agent secret when GitHub auth is available, or missing sandbox
prerequisites when `sandbox.provider` is set in config (see
[Sandbox providers](sandbox.md)).

Schema `1.1` configs may include a `sandbox` block alongside `agent`. Dispatch
payloads still do not carry sandbox settings; repo config remains the source of
truth for CI as well.

### Denoise-task operations

Protocol v1 adds a `denoise-task` operation type alongside `kickstart`. A
denoise-task job carries an inline `DenoiseTaskDocument` instead of a GitHub
issue URL:

```typescript
interface DenoiseTaskDocument {
  schema_version: "1.0";
  id: string; // Opaque task identifier
  title: string; // Task title (maps to H1 in materialized markdown)
  body: string; // Markdown description
  repository?: string; // Optional owner/repo slug
  labels?: string[]; // Optional tags
  acceptance_criteria?: string[]; // Optional explicit criteria items
  created_at: string; // ISO-8601 timestamp
}
```

The device runner materializes the task document into a plan-compatible markdown
file and runs `dn kickstart --publish <mode> <materialized_path>`. Cross-repo
validation is relaxed for denoise-task operations — the repository is derived
from `task_document.repository` if present.

Queue a denoise-task job via the runner API:

```bash
POST /api/runners/denoise-task
{
  "runner_id": "<id>",
  "task_document": { ... },
  "publish": "pr"
}
```

Returns the same `RunnerKickstartResponse` shape (invocation_id, job_id, state,
expires_at).

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
