---
name: base-image
description: Use when configuring dn Docker sandbox golden images, choosing or customizing a project base image / Dockerfile, or setting sandbox.docker.image and sandbox.docker.dockerfile in .github/dn/config.json.
---

# Project base image (golden image)

Maintain a **golden image** for agent sandbox environments: a reproducible
container with Deno, `dn`, an agent harness, and `git`. Point dn at the image
from config; fork a Dockerfile when the project needs extra toolchains.

## Config

In `.github/dn/config.json` (schema `1.1`), under `sandbox.docker`:

| Field        | Purpose                                                              |
| ------------ | -------------------------------------------------------------------- |
| `image`      | Runtime image pull ref (required for Docker sandbox)                 |
| `dockerfile` | Optional repo-relative path to the Dockerfile that builds that image |

`dockerfile` is declarative only — dn does **not** build at provision time.
Build and push yourself (or in CI), then set `image` to the published tag or
digest.

Example:

```json
{
  "schema_version": "1.1",
  "agent": "opencode",
  "sandbox": {
    "provider": "docker",
    "docker": {
      "image": "ghcr.io/OWNER/project:sha-abc1234",
      "dockerfile": "Dockerfile",
      "network": "bridge",
      "read_only_root": true,
      "env_pass_through": [
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "CURSOR_API_KEY"
      ]
    }
  }
}
```

Install this skill into a consumer repo:

```bash
dn init agents --skill base-image --agent opencode
```

## Image contract

The image must include:

- **Deno** runtime (≥ 2.6.3)
- **dn** CLI (precompiled or from the workspace)
- **Agent harness** (opencode, cursor, claude, codex, or copilot)
- **git**, plus a shell (`bash`) for agent commands

Canonical images are published from
[chesapeakedev/dn-images](https://github.com/chesapeakedev/dn-images) as
`ghcr.io/chesapeakedev/dn:<harness>`. Version and source tags include the
harness suffix, such as `:0.1.0-codex` and `:sha-abc123def456-codex`.

dn Docker runner expects a long-lived container (`ENTRYPOINT` can be
`sleep infinity`); the workspace is bind-mounted (default `/workspace`).

## Hygiene (do this)

- Pin `FROM` by **digest** (`image@sha256:…`); keep the human tag in a comment
- Pin tool versions (`OPENCODE_VERSION`, Deno base, language runtimes)
- Prefer **`:sha-*` or digest** in `sandbox.docker.image` for CI; `:latest` only
  for local throwaways
- Run as a **non-root** `USER` in the final stage when mounts stay writable
- **Never bake secrets** into layers; use `env_pass_through` / runtime env
- Keep `network` default `none`; use `bridge` only when outbound LLM/GitHub APIs
  are required
- Prefer `read_only_root: true` with a writable workspace mount
- Use multi-stage builds so compilers/`deno compile` stay out of the final image
- Stay on **Debian-family** bases (`denoland/deno:debian-*`). Do not use
  distroless/Chainguard-static as the agent base — agents need a shell and git
- Do **not** mount the Docker socket or full `~/.ssh`; pass short-lived tokens
- Treat Docker sandbox as reproducibility / blast-radius reduction, not a hard
  security boundary. Prefer `exe.dev` (or similar microVM) for stronger
  isolation

## Useful base-image suggestions

1. **dn (default)** — use the canonical tag matching the selected harness.
2. **VCS overlay** — add Sapling (`sl`) when the repo uses Sapling; keep `git`
   for remotes/GitHub.
3. **Language overlays** — fork the Dockerfile for Node/npm or bun, Python
   (uv/pip), or Rust/`cargo`. Do not bloat the shared default.
4. **Harness variants** — one primary harness per image. Avoid shipping every
   CLI in one image.
5. **Pinned prod config** — `image` → `:sha-<commit>` or digest + `dockerfile`
   path for rebuilds.
6. **When not to customize** — if `sandbox.provider` is `none`, skip a project
   image. If you need stronger isolation, prefer `exe.dev` over a fatter Docker
   image.

## STOP conditions

- Do not bake API keys, tokens, or SSH private keys into the image
- Do not recommend distroless/static images as the agent sandbox base
- Do not mount the host Docker socket into the sandbox
- Publishing `ghcr.io/chesapeakedev/dn` requires package permissions for the
  Chesapeake organization

## Related docs

- Sandbox providers and Docker contract: `docs/sandbox.md` in the dn repository
- Canonical image source: `chesapeakedev/dn-images`
