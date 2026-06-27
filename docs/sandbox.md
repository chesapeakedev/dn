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
| `sandbox.docker.*`  | Image, mounts, network mode, env pass-through                            |
| `sandbox.exe_dev.*` | exe.dev VM image, naming prefix, TTL, integrations                       |

Secrets never go in `config.json`. Provider credentials are environment
variables:

| Provider | Env var                                                   |
| -------- | --------------------------------------------------------- |
| exe.dev  | `EXE_TOKEN` (from `ssh exe.dev ssh-key generate-api-key`) |
| docker   | Local Docker socket (no token)                            |

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
   mounts; git-push-temp-branch for exe.dev)
4. Routes agent harness execution (plan, implement, merge) through
   `SandboxRunner.exec` so the agent runs **inside** the sandbox
5. Syncs changes back (`syncOut`)
6. Tears down infrastructure (container / VM)

The inner agent run receives `DN_SANDBOX_PROVIDER=none` and `DN_IN_SANDBOX=1`
env vars to prevent recursive sandbox provisioning.

Combined prompt files are created under `.dn/tmp/` inside the workspace when a
sandbox is active, ensuring they are visible inside the container or VM.

## Validation

`dn workflows validate` warns when `sandbox.provider` is set but prerequisites
are missing:

- `docker`: `docker` on PATH and a running daemon
- `exe.dev`: `EXE_TOKEN` set

## Docker image contract

The default image is `ghcr.io/chesapeakedev/dn-kickstart:latest`. Build it with:

```bash
docker build -t ghcr.io/chesapeakedev/dn-kickstart:latest -f docker/Dockerfile .
```

The image must include:

- **Deno runtime** (for dn and opencode)
- **dn CLI** (from workspace or pre-installed)
- **Agent harness** (opencode, or another CLI like `agent` for Cursor)
- **git** (for VCS operations)

A reference Dockerfile is at `docker/Dockerfile` in the dn repository.

Default `sandbox.docker.network` is `none`; set `bridge` when the agent needs
outbound API access.

## exe.dev notes

- Control plane: `POST https://exe.dev/exec` with
  `Authorization: Bearer $EXE_TOKEN`
- HTTPS API timeout is 30s; long-running commands use SSH exec via the API
- Workspace sync uses git: the host pushes the current branch to a temp branch
  on `origin`, the VM clones/pulls that branch, and after agent phases the VM
  pushes back. Requires the repo to have a remote configured and the VM to have
  GitHub SSH access (via the `github` integration).
- Optional LLM gateway inside VMs: `http://169.254.169.254/gateway/`

## CI behavior

In GitHub Actions, sandbox defaults to `none` — GHA runners are already
ephemeral VMs. Docker sandbox is optional in CI when a Docker socket is
available. exe.dev sandbox from GHA requires the `EXE_TOKEN` secret.
