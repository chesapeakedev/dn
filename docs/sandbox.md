# Sandbox providers

Sandbox providers define **where** kickstart and loop agent phases execute: on
the host (default), in a local Docker container, or on an exe.dev VM.

## Config (schema 1.1)

Bump `.github/dn/config.json` to `schema_version: "1.1"` and add an optional
`sandbox` block. Schema `1.0` configs without `sandbox` behave as today (host
execution).

See `templates/workflows/dn-config.sandbox.example.json` for a full example.

| Field               | Purpose                                                                  |
| ------------------- | ------------------------------------------------------------------------ |
| `sandbox.provider`  | `none` (default) \| `docker` \| `exe.dev`                                |
| `sandbox.workspace` | Path inside the sandbox where the repo is mounted                        |
| `sandbox.sync`      | How the host workspace maps (`bind` for Docker; `git_clone` for exe.dev) |
| `sandbox.docker.*`  | Image, optional Dockerfile path, mounts, network, env pass-through       |
| `sandbox.exe_dev.*` | exe.dev VM image, naming prefix, TTL, integrations                       |

Secrets never go in `config.json`. Provider credentials are environment
variables:

| Provider | Env var                                                        |
| -------- | -------------------------------------------------------------- |
| exe.dev  | `EXE_TOKEN` — see [exe.dev API token](#exedev-api-token) below |
| docker   | Local Docker socket (no token)                                 |

## CLI overrides

```bash
dn kickstart --sandbox docker https://github.com/owner/repo/issues/1
dn loop --sandbox docker plans/foo.plan.md
dn --sandbox exe.dev kickstart 42
```

- `--sandbox` with no value reads `sandbox.provider` from config (errors if
  missing)
- `--sandbox none` forces host execution even when config says `docker`
- `DN_SANDBOX_PROVIDER=docker` overrides config when `--sandbox` is absent
- `DN_SANDBOX_DRY_RUN=1` logs planned `docker run` / exe.dev API calls without
  mutating infrastructure

## How it works

The host `dn` process:

1. Parses the sandbox config from `.github/dn/config.json`
2. Provisions infrastructure (Docker container or exe.dev VM)
3. Syncs the workspace into the sandbox (`syncIn` — no-op for Docker bind
   mounts; topic-branch checkpoints for exe.dev)
4. Routes agent harness execution (plan, implement, merge) through
   `SandboxRunner.exec` so the agent runs **inside** the sandbox
5. Syncs exe.dev changes back after each agent phase, before host validation and
   PR publishing
6. Tears down infrastructure (container / VM)

The inner agent run receives `DN_SANDBOX_PROVIDER=none` and `DN_IN_SANDBOX=1`
env vars to prevent recursive sandbox provisioning.

Combined prompt files are created under `.dn/tmp/` inside the workspace when a
sandbox is active, ensuring they are visible inside the container or VM.

Host paths are translated to sandbox workspace paths before agent and lint
commands run inside the container or VM.

## Supported subcommands

| Subcommand  | Sandbox support                      |
| ----------- | ------------------------------------ |
| `kickstart` | Full plan + implement inside sandbox |
| `loop`      | Implement phase inside sandbox       |
| `meld`      | Plan phase inside sandbox            |

## Validation

`dn workflows validate` warns when `sandbox.provider` is set but prerequisites
are missing:

- `docker`: `docker` on PATH and a running daemon
- `exe.dev`: `EXE_TOKEN` set

## Docker image contract

The canonical images are published from
[`chesapeakedev/dn-images`](https://github.com/chesapeakedev/dn-images) under
the `ghcr.io/chesapeakedev/dn` package. Select the tag matching the configured
agent:

| Agent       | Moving image                        |
| ----------- | ----------------------------------- |
| OpenCode    | `ghcr.io/chesapeakedev/dn:opencode` |
| Cursor      | `ghcr.io/chesapeakedev/dn:cursor`   |
| Claude Code | `ghcr.io/chesapeakedev/dn:claude`   |
| Codex       | `ghcr.io/chesapeakedev/dn:codex`    |
| Copilot     | `ghcr.io/chesapeakedev/dn:copilot`  |

Release and source-SHA tags add the harness suffix, for example `:0.1.0-codex`
and `:sha-abc123def456-codex`. OpenCode is the default harness, so it also
receives the unqualified `:latest`, release, and source-SHA tags. Production
configs should pin a source-SHA tag or digest.

Each image includes:

- **Deno runtime** (for dn and opencode)
- **dn CLI** (from workspace or pre-installed)
- **Exactly one agent harness** matching its tag
- **git** (for VCS operations)

The Dockerfile and release workflow live only in `chesapeakedev/dn-images`. Fork
that repository when a project needs additional toolchains.

Optional `sandbox.docker.dockerfile` is a **repo-relative path** to the
Dockerfile that builds `sandbox.docker.image`. It is declarative only — dn does
not build at provision time. Prefer pinning CI configs to `:sha-*` tags or
digests rather than `:latest`.

| Field                       | Purpose                                             |
| --------------------------- | --------------------------------------------------- |
| `sandbox.docker.image`      | Runtime pull ref for the sandbox container          |
| `sandbox.docker.dockerfile` | Optional path to the Dockerfile that builds `image` |

Default `sandbox.docker.network` is `none`; set `bridge` when the agent needs
outbound API access.

### Project base image skill

Install the golden-image skill into a consumer repo for hygiene guidance and
customization suggestions (VCS/language/harness overlays, digest pinning, no
secrets in layers):

```bash
dn init agents --skill base-image --agent opencode
```

See also `.agents/skills/base-image/` in this repository.

## exe.dev notes

### exe.dev API token

`dn` calls the exe.dev lobby over `POST https://exe.dev/exec` with
`Authorization: Bearer $EXE_TOKEN`. Each POST body is an SSH-style command.

| Phase              | API command                           | Required token `cmds` |
| ------------------ | ------------------------------------- | --------------------- |
| Provision VM       | `new <name> --image … --ttl … --json` | `new`                 |
| Agent + sync on VM | `ssh <name> -- …`                     | `ssh`                 |
| Teardown           | `rm <name> --json`                    | `rm`                  |

The default token from `ssh exe.dev ssh-key generate-api-key` includes `new` but
**not** `ssh` or `rm`. When you pass `--cmds`, it **replaces** the default list
(does not merge). Generate a dn-scoped token with:

```bash
make exe_dev_token
# or manually:
ssh exe.dev ssh-key generate-api-key \
  --label=dn-kickstart \
  --cmds=new,ssh,rm \
  --exp=90d
export EXE_TOKEN='exe1....'
```

Optional: `EXE_TOKEN_LABEL`, `EXE_TOKEN_EXP` env vars for `make exe_dev_token`.

Permissions model:
[exe.dev HTTPS API — Granular permissions](https://exe.dev/docs/https-api#granular-permissions).
Do **not** use `--vm` on `generate-api-key` — that creates a VM-scoped token for
the VM HTTPS proxy, not lobby `new`/`ssh`/`rm`.

Host-side git push/pull uses your local credentials, not `EXE_TOKEN`.

### Runtime behavior

- Control plane: `POST https://exe.dev/exec` with
  `Authorization: Bearer $EXE_TOKEN`
- HTTPS API timeout is 30s; long-running commands use SSH exec via the API
- Workspace sync uses git and requires `--publish pr`: the host checkpoints the
  issue topic branch on `origin`, the VM clones or refreshes that branch, and
  the VM pushes each agent phase before its diff is applied to the host.
  Host-side validation then runs against those changes and creates or updates
  the PR through the normal kickstart publisher. Failed runs retain the remote
  topic branch for recovery. This requires a configured remote and GitHub SSH
  access in the VM (via the `github` integration).
- `sandbox.sync.exclude` patterns are applied during git sync (pathspec excludes
  for `node_modules`, `.git`, etc.)
- Optional LLM gateway inside VMs: `http://169.254.169.254/gateway/`

## CI behavior

In GitHub Actions, sandbox defaults to `none` — GHA runners are already
ephemeral VMs. Docker sandbox is optional in CI when a Docker socket is
available. exe.dev sandbox from GHA requires the `EXE_TOKEN` secret.
